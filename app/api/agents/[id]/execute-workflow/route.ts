// app/api/agents/[id]/execute-workflow/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { pluginRegistry } from '@/lib/plugins/pluginRegistry'

export const runtime = 'nodejs'

interface WorkflowExecutionRequest {
  inputVariables: Record<string, any>
  testMode?: boolean
}

interface WorkflowStep {
  id: number
  phase: 'input' | 'process' | 'output'
  action: string
  pluginKey: string
}

function buildStepParameters(
  step: WorkflowStep,
  inputVariables: Record<string, any>,
  executionContext: Record<string, any>,
  inputSchema: any[]
): Record<string, any> {
  
  const parameters: Record<string, any> = {}
  
  switch (step.phase) {
    case 'input':
      return filterParametersForInputPhase(inputVariables, step.pluginKey, inputSchema)
      
    case 'process':
      const inputData = findDataInContext(executionContext, 'input')
      if (inputData) {
        parameters.inputData = inputData
        parameters.sourceData = inputData
        parameters.processingMode = step.action
        parameters.workflowTask = step.action
        
        if (step.action.toLowerCase().includes('summarize')) {
          parameters.mode = 'summarize'
          parameters.task = 'summarize_content'
        }
        if (step.action.toLowerCase().includes('analyze')) {
          parameters.mode = 'analyze'
          parameters.task = 'analyze_content'
        }
        if (step.action.toLowerCase().includes('research')) {
          parameters.mode = 'research'
          parameters.task = 'research_content'
        }
      }
      Object.assign(parameters, filterParametersForProcessPhase(inputVariables, step.pluginKey, inputSchema))
      break
      
    case 'output':
      const processedData = findDataInContext(executionContext, 'process')
      if (processedData) {
        parameters.contentToSave = processedData
        parameters.outputData = processedData
      }
      Object.assign(parameters, filterParametersForOutputPhase(inputVariables, step.pluginKey, inputSchema))
      break
  }
  
  parameters._workflowContext = {
    stepId: step.id,
    phase: step.phase,
    action: step.action,
    pluginKey: step.pluginKey,
    hasInputData: !!findDataInContext(executionContext, 'input'),
    hasProcessedData: !!findDataInContext(executionContext, 'process')
  }
  
  return parameters
}

function filterParametersForInputPhase(
  inputVariables: Record<string, any>,
  pluginKey: string,
  inputSchema: any[]
): Record<string, any> {
  const filtered: Record<string, any> = {}
  
  inputSchema.forEach(field => {
    const fieldName = field.name.toLowerCase()
    const value = inputVariables[field.name]
    
    if (value !== undefined) {
      if (!fieldName.includes('folder') && 
          !fieldName.includes('path') && 
          !fieldName.includes('destination') &&
          !fieldName.includes('output')) {
        filtered[field.name] = value
      }
    }
  })
  
  return filtered
}

function filterParametersForProcessPhase(
  inputVariables: Record<string, any>,
  pluginKey: string,
  inputSchema: any[]
): Record<string, any> {
  return filterParametersForInputPhase(inputVariables, pluginKey, inputSchema)
}

function filterParametersForOutputPhase(
  inputVariables: Record<string, any>,
  pluginKey: string,
  inputSchema: any[]
): Record<string, any> {
  const filtered: Record<string, any> = {}
  
  inputSchema.forEach(field => {
    const fieldName = field.name.toLowerCase()
    const value = inputVariables[field.name]
    
    if (value !== undefined) {
      if (fieldName.includes('folder') || 
          fieldName.includes('path') || 
          fieldName.includes('destination') ||
          fieldName.includes('output') ||
          fieldName.includes('account') ||
          fieldName.includes('workspace')) {
        filtered[field.name] = value
      }
    }
  })
  
  return filtered
}

function findDataInContext(context: Record<string, any>, phaseType: 'input' | 'process'): any {
  console.log(`Looking for ${phaseType} data in context:`, Object.keys(context))
  
  for (const [key, value] of Object.entries(context)) {
    console.log(`Checking context key: ${key}, value type: ${typeof value}`)
    
    if (value && typeof value === 'object') {
      if (phaseType === 'input') {
        // Check for input data structures
        const hasInputData = value.emails || value.emailsReturned || value.documents || value.data || value.files
        console.log(`Input data check for ${key}:`, {
          hasEmails: !!value.emails,
          hasEmailsReturned: !!value.emailsReturned,
          hasDocuments: !!value.documents,
          hasData: !!value.data,
          hasFiles: !!value.files,
          found: !!hasInputData
        })
        
        if (hasInputData) {
          console.log(`Found input data in context key: ${key}`)
          return value
        }
      }
      
      if (phaseType === 'process') {
        const hasProcessData = value.summary || value.analysis || value.result || value.processed || value.research
        console.log(`Process data check for ${key}:`, {
          hasSummary: !!value.summary,
          hasAnalysis: !!value.analysis,
          hasResult: !!value.result,
          hasProcessed: !!value.processed,
          hasResearch: !!value.research,
          found: !!hasProcessData
        })
        
        if (hasProcessData) {
          console.log(`Found process data in context key: ${key}`)
          return value
        }
      }
    }
  }
  
  console.log(`No ${phaseType} data found in execution context`)
  return null
}

// ADDED: Helper function to generate formatted result like the old mechanism
function generateFormattedResult(
  results: any[],
  inputVariables: Record<string, any>,
  agentData: any
): string {
  let formattedResult = ''
  
  // Find the process step result (usually step 2 in your workflow)
  const processStep = results.find(r => r.phase === 'process' && r.result?.response)
  
  if (processStep?.result?.response) {
    formattedResult = processStep.result.response
  } else {
    // Fallback: construct from available data
    formattedResult = `### Agent Execution Summary\n\n`
    
    // Add input information
    if (Object.keys(inputVariables).length > 0) {
      formattedResult += `**Input Variables:**\n`
      Object.entries(inputVariables).forEach(([key, value]) => {
        formattedResult += `- **${key}:** ${value}\n`
      })
      formattedResult += `\n`
    }
    
    // Add results from each step
    results.forEach((result, index) => {
      if (result.result && !result.error) {
        formattedResult += `**Step ${result.stepId} (${result.pluginKey}):** ${result.action}\n`
        
        if (result.result.summary) {
          formattedResult += `${result.result.summary}\n\n`
        } else if (result.result.response) {
          formattedResult += `${result.result.response}\n\n`
        } else if (typeof result.result === 'string') {
          formattedResult += `${result.result}\n\n`
        } else {
          formattedResult += `Completed successfully\n\n`
        }
      } else if (result.error) {
        formattedResult += `**Step ${result.stepId} (${result.pluginKey}):** Failed - ${result.error}\n\n`
      }
    })
  }
  
  return formattedResult
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    console.log('Starting workflow execution request...')
    
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

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      console.log('Authentication failed:', authError?.message || 'No user')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('Authenticated user:', user.email)

    const agentId = (await params).id
    const { inputVariables = {}, testMode = false }: WorkflowExecutionRequest = await req.json()
    const startTime = Date.now()
    
    // Generate execution ID for tracking
    const executionId = `workflow_${agentId}_${Date.now()}`
    
    console.log(`Starting workflow execution for agent ${agentId}`)
    console.log('Input variables:', Object.keys(inputVariables))
    
    // Initialize execution tracking
    console.log(`Starting execution tracking for: ${executionId}`)
    
    const { error: execError } = await supabase
      .from('agent_executions')
      .insert({
        id: executionId,
        agent_id: agentId,
        user_id: user.id,
        status: 'running',
        created_at: new Date().toISOString()
      })

    if (execError) {
      console.error('Failed to create execution record:', execError)
    } else {
      console.log('Execution record created successfully')
    }
    
    // Fetch agent
    const { data: agent, error } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .eq('user_id', user.id)
      .single()

    if (error || !agent) {
      console.log('Agent lookup error:', error)
      throw new Error(`Agent not found: ${agentId}`)
    }

    console.log(`Found agent: ${agent.agent_name}`)

    const workflowSteps = agent.workflow_steps || []
    if (workflowSteps.length === 0) {
      throw new Error('No workflow steps defined for this agent')
    }

    const sortedSteps = [...workflowSteps].sort((a, b) => a.id - b.id)
    console.log(`Executing ${sortedSteps.length} workflow steps:`, sortedSteps.map(s => `${s.id}:${s.pluginKey}`))

    // Log workflow start
    const { error: startLogError } = await supabase.from('agent_execution_logs').insert({
      execution_id: executionId,
      agent_id: agentId,
      user_id: user.id,
      timestamp: new Date().toISOString(),
      level: 'info',
      message: `Starting workflow execution with ${sortedSteps.length} steps: ${sortedSteps.map(s => s.pluginKey).join(', ')}`,
      phase: 'workflow'
    })

    if (startLogError) {
      console.error('Failed to insert start log:', startLogError)
    }

    const executionContext: Record<string, any> = {}
    const results: any[] = []
    let finalResult: any = null

    // Execute steps sequentially
    for (const [stepIndex, step] of sortedSteps.entries()) {
      console.log(`Executing step ${step.id}: ${step.action} (${step.pluginKey})`)

      // Log step start
      const { error: stepStartLogError } = await supabase.from('agent_execution_logs').insert({
        execution_id: executionId,
        agent_id: agentId,
        user_id: user.id,
        timestamp: new Date().toISOString(),
        level: 'info',
        message: `Step ${stepIndex + 1}/${sortedSteps.length}: Starting ${step.action} using ${step.pluginKey} (${step.phase} phase)`,
        phase: 'workflow'
      })

      if (stepStartLogError) {
        console.error('Failed to insert step start log:', stepStartLogError)
      }

      const stepParameters = buildStepParameters(step, inputVariables, executionContext, agent.input_schema || [])

      const plugin = pluginRegistry[step.pluginKey]
      if (!plugin) {
        const errorMsg = `Plugin not found: ${step.pluginKey}`
        
        // Log plugin error
        const { error: pluginLogError } = await supabase.from('agent_execution_logs').insert({
          execution_id: executionId,
          agent_id: agentId,
          user_id: user.id,
          timestamp: new Date().toISOString(),
          level: 'error',
          message: errorMsg,
          phase: 'workflow'
        })

        if (pluginLogError) {
          console.error('Failed to insert plugin error log:', pluginLogError)
        }
        
        throw new Error(errorMsg)
      }

      // Get connection
      let connection = null
      if (plugin.run) {
        const { data: connectionData } = await supabase
          .from('plugin_connections')
          .select('*')
          .eq('user_id', user.id)
          .eq('plugin_key', step.pluginKey)
          .single()
        
        connection = connectionData
        console.log(`Plugin connection for ${step.pluginKey}:`, connection ? 'Found' : 'Not found')
      }

      try {
        const stepResult = await plugin.run!({
          connection,
          userId: user.id,
          input_variables: stepParameters
        })

        const stepOutput = {
          stepId: step.id,
          pluginKey: step.pluginKey,
          phase: step.phase,
          action: step.action,
          result: stepResult,
          executedAt: new Date().toISOString()
        }

        results.push(stepOutput)
        executionContext[`${step.phase}_${step.pluginKey}_${step.id}`] = stepResult
        
        if (step.phase === 'output' || step.id === sortedSteps[sortedSteps.length - 1].id) {
          finalResult = stepResult
        }

        console.log(`Step ${step.id} completed successfully`)

        // Log step completion
        const { error: stepCompleteLogError } = await supabase.from('agent_execution_logs').insert({
          execution_id: executionId,
          agent_id: agentId,
          user_id: user.id,
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `Step ${stepIndex + 1}/${sortedSteps.length}: Completed ${step.action} successfully`,
          phase: 'workflow'
        })

        if (stepCompleteLogError) {
          console.error('Failed to insert step complete log:', stepCompleteLogError)
        }

      } catch (stepError: any) {
        console.error(`Step ${step.id} failed:`, stepError.message)
        
        const errorOutput = {
          stepId: step.id,
          pluginKey: step.pluginKey,
          phase: step.phase,
          action: step.action,
          error: stepError.message,
          executedAt: new Date().toISOString()
        }
        
        results.push(errorOutput)
        executionContext[`${step.phase}_${step.pluginKey}_${step.id}_error`] = stepError.message

        // Log step error
        const { error: stepErrorLogError } = await supabase.from('agent_execution_logs').insert({
          execution_id: executionId,
          agent_id: agentId,
          user_id: user.id,
          timestamp: new Date().toISOString(),
          level: 'error',
          message: `Step ${stepIndex + 1}/${sortedSteps.length}: Failed ${step.action} - ${stepError.message}`,
          phase: 'workflow'
        })

        if (stepErrorLogError) {
          console.error('Failed to insert step error log:', stepErrorLogError)
        }
      }
    }

    const endTime = Date.now()
    const executionDuration = endTime - startTime

    console.log('Workflow execution completed')

    const completedSteps = results.filter(r => !r.error).length
    const failedSteps = results.filter(r => r.error).length
    const overallSuccess = completedSteps > 0

    // MODIFIED: Generate formatted result like the old mechanism
    const formattedResult = generateFormattedResult(results, inputVariables, agent)

    // Log workflow completion
    const { error: completeLogError } = await supabase.from('agent_execution_logs').insert({
      execution_id: executionId,
      agent_id: agentId,
      user_id: user.id,
      timestamp: new Date().toISOString(),
      level: 'info',
      message: `Workflow execution completed in ${executionDuration}ms - ${completedSteps} steps succeeded, ${failedSteps} steps failed`,
      phase: 'workflow'
    })

    if (completeLogError) {
      console.error('Failed to insert completion log:', completeLogError)
    }

    // Update execution record
    const { error: updateError } = await supabase.from('agent_executions').update({
      status: overallSuccess ? (failedSteps > 0 ? 'partial' : 'completed') : 'failed',
      duration_ms: executionDuration,
      completed_at: new Date().toISOString()
    }).eq('id', executionId)

    if (updateError) {
      console.error('Failed to update execution completion:', updateError)
    }

    // MODIFIED: Insert main agent log with formatted result like old mechanism
    console.log('Inserting agent log...')
    const { data: logData, error: logInsertError } = await supabase
      .from('agent_logs')
      .insert({
        agent_id: agentId,
        user_id: user.id,
        // CHANGED: Use formatted result instead of JSON stringified finalResult
        run_output: formattedResult,
        full_output: { 
          workflow_results: results,
          execution_summary: {
            totalSteps: sortedSteps.length,
            completedSteps,
            failedSteps,
            executionDuration,
            executionId
          }
        },
        status: overallSuccess ? (failedSteps > 0 ? 'Partial Success' : 'Success') : 'Failed',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (logInsertError) {
      console.error('Failed to insert log into agent_logs:', logInsertError)
    } else {
      console.log('Agent log inserted successfully')

      // Insert output context for each step result
      if (logData?.id) {
        console.log('Inserting agent output context...')
        
        const contextEntries = []
        
        // Add overall workflow context
        contextEntries.push({
          user_id: user.id,
          source_agent_id: agentId,
          run_id: logData.id,
          context_key: 'workflow_execution',
          context_data: {
            executionId,
            totalSteps: sortedSteps.length,
            completedSteps,
            failedSteps,
            executionDuration
          }
        })

        // Add individual step results
        results.forEach(stepResult => {
          if (stepResult.result) {
            contextEntries.push({
              user_id: user.id,
              source_agent_id: agentId,
              run_id: logData.id,
              context_key: `step_${stepResult.stepId}_${stepResult.pluginKey}`,
              context_data: stepResult.result
            })
          }
        })
        
        // Add input variables as context
        if (inputVariables && Object.keys(inputVariables).length > 0) {
          contextEntries.push({
            user_id: user.id,
            source_agent_id: agentId,
            run_id: logData.id,
            context_key: 'input_variables',
            context_data: inputVariables
          })
        }

        if (contextEntries.length > 0) {
          const { error: contextInsertError } = await supabase
            .from('agent_output_context')
            .insert(contextEntries)

          if (contextInsertError) {
            console.error('Failed to insert agent output context:', contextInsertError)
          } else {
            console.log('Agent output context inserted successfully')
          }
        }
      }
    }

    // Update agent stats
    console.log('Updating agent_stats...')
    const { error: statsError } = await supabase.rpc('increment_agent_stats', {
      agent_id_input: agentId,
      user_id_input: user.id,
      success: overallSuccess,
    })

    if (statsError) {
      console.error('Failed to update agent_stats:', statsError)
    } else {
      console.log('agent_stats updated')
    }

    // MODIFIED: Return response that includes the formatted result like old mechanism
    return NextResponse.json({
      success: true,
      agentId,
      executionId,
      totalSteps: sortedSteps.length,
      completedSteps,
      failedSteps,
      results,
      // ADDED: Include the formatted result in the response like the old mechanism
      result: formattedResult,
      finalResult,
      executionContext: testMode ? executionContext : undefined,
      executedAt: new Date().toISOString(),
      executionDuration
    })

  } catch (error: any) {
    console.error('Workflow execution failed:', error)
    
    // Log critical error if we have execution context
    const agentId = (await params).id
    const executionId = `workflow_${agentId}_${Date.now()}`
    
    try {
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

      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        // Log the critical error
        await supabase.from('agent_execution_logs').insert({
          execution_id: executionId,
          agent_id: agentId,
          user_id: user.id,
          timestamp: new Date().toISOString(),
          level: 'error',
          message: `Critical workflow error: ${error.message}`,
          phase: 'workflow'
        })

        // Update execution as failed if it exists
        await supabase.from('agent_executions').update({
          status: 'failed',
          completed_at: new Date().toISOString()
        }).eq('id', executionId)
      }
    } catch (loggingError) {
      console.error('Failed to log critical error:', loggingError)
    }

    return NextResponse.json({ 
      error: error.message,
      agentId: (await params).id
    }, { status: 500 })
  }
}