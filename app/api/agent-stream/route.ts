// app/api/agent-stream/route.ts

import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { runAgentWithContext } from '@/lib/utils/runAgentWithContext'
import { interpolatePrompt } from '@/lib/utils/interpolatePrompt'
import { extractPdfTextFromBase64 } from '@/lib/utils/extractPdfTextFromBase64'

export const runtime = 'nodejs'

// Create a custom console that sends events to the stream
function createStreamingConsole(sendEvent: (data: any) => void, storeLogInDb?: (log: any) => Promise<void>) {
  const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn
  }

  // Phase detection patterns
  const PHASE_PATTERNS = [
    { id: 'memory', keywords: ['loading contextual memory', 'phase 1', 'memory', 'contextual memory'] },
    { id: 'intent', keywords: ['intent analysis', 'phase 2', 'analyzing intent', 'universal intent', 'primaryIntent'] },
    { id: 'strategy', keywords: ['adaptive strategy', 'phase 3', 'strategy generation', 'generating adaptive strategy'] },
    { id: 'plugins', keywords: ['plugin coordination', 'phase 4', 'executing smart plugin', 'chatgpt-research', 'google-mail', 'smart plugin'] },
    { id: 'documents', keywords: ['processing documents', 'phase 5', 'document intelligence', 'extracted content'] },
    { id: 'prompt', keywords: ['prompt generation', 'phase 6', 'universal smart prompt', 'generating universal smart prompt'] },
    { id: 'llm', keywords: ['executing with gpt-4o', 'phase 7', 'data-aware intelligence', 'llm execution'] },
    { id: 'validation', keywords: ['quality validation', 'phase 8', 'learning system', 'execution completed', 'ultra-smart execution completed'] }
  ]

  const detectPhase = (message: string) => {
    const lowerMessage = message.toLowerCase()
    for (const pattern of PHASE_PATTERNS) {
      if (pattern.keywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()))) {
        return pattern.id
      }
    }
    return undefined
  }

  const extractMetrics = (message: string) => {
    const metrics: any = {}
    
    const confidenceMatch = message.match(/confidence[:\s]+([0-9.]+)/i)
    if (confidenceMatch) metrics.confidence = parseFloat(confidenceMatch[1])
    
    const qualityMatch = message.match(/qualityScore[:\s]+['"]?([A-F][+-]?)['"]?/i)
    if (qualityMatch) metrics.qualityScore = qualityMatch[1]
    
    const contextMatch = message.match(/businessContext[:\s]+['"]([^'"]+)['"]?/i)
    if (contextMatch) metrics.businessContext = contextMatch[1]
    
    if (message.toLowerCase().includes('dataprocessed: true')) {
      metrics.dataProcessed = true
    }
    
    const pluginMatch = message.match(/smart plugin[:\s]+([a-z-]+)/i)
    if (pluginMatch) metrics.pluginUsed = pluginMatch[1]
    
    return Object.keys(metrics).length > 0 ? metrics : null
  }

  // Override console methods
  console.log = (...args: any[]) => {
    const message = args.join(' ')
    const phase = detectPhase(message)
    const metrics = extractMetrics(message)
    const timestamp = new Date().toISOString()
    
    // Stream the event
    sendEvent({
      type: 'log',
      level: 'info',
      message,
      phase,
      metrics,
      timestamp
    })
    
    // Store in database if we have execution context
    if (storeLogInDb) {
      storeLogInDb({
        level: 'info',
        message,
        phase,
        timestamp
      })
    }
    
    // Still log to original console
    originalConsole.log(...args)
  }

  console.error = (...args: any[]) => {
    const message = args.join(' ')
    const phase = detectPhase(message)
    const timestamp = new Date().toISOString()
    
    // Stream the event
    sendEvent({
      type: 'log',
      level: 'error',
      message,
      phase,
      timestamp
    })
    
    // Store in database if we have execution context
    if (storeLogInDb) {
      storeLogInDb({
        level: 'error',
        message,
        phase,
        timestamp
      })
    }
    
    originalConsole.error(...args)
  }

  console.warn = (...args: any[]) => {
    const message = args.join(' ')
    const phase = detectPhase(message)
    const timestamp = new Date().toISOString()
    
    // Stream the event
    sendEvent({
      type: 'log',
      level: 'warn',
      message,
      phase,
      timestamp
    })
    
    // Store in database if we have execution context
    if (storeLogInDb) {
      storeLogInDb({
        level: 'warn',
        message,
        phase,
        timestamp
      })
    }
    
    originalConsole.warn(...args)
  }

  return () => {
    console.log = originalConsole.log
    console.error = originalConsole.error
    console.warn = originalConsole.warn
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { agent_id, input_variables = {}, user_prompt, execution_id } = body
  
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
    return new Response('Unauthorized', { status: 401 })
  }

  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agent_id)
    .single()

  if (agentError || !agent) {
    return new Response('Agent not found', { status: 404 })
  }

  // Create the stream
  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (data: any) => {
        const sseData = `data: ${JSON.stringify(data)}\n\n`
        controller.enqueue(new TextEncoder().encode(sseData))
      }

      // Send initial event
      sendEvent({ type: 'start', execution_id })

      // Create database log storage function
      const storeLogInDb = async (logData: any) => {
        if (!execution_id || !user?.id) return
        
        try {
          const { error } = await supabase.from('agent_execution_logs').insert({
            execution_id,
            agent_id,
            user_id: user.id,
            timestamp: logData.timestamp,
            level: logData.level,
            message: logData.message,
            phase: logData.phase,
            created_at: new Date().toISOString()
          })
          
          if (error) {
            console.error('Failed to store execution log:', error)
          }
        } catch (error) {
          console.error('Database log error:', error)
        }
      }

      // Set up streaming console with database logging
      const restoreConsole = createStreamingConsole(sendEvent, storeLogInDb)

      // Execute agent with streaming
      const executeAgent = async () => {
        try {
          // Create execution record
          if (execution_id) {
            await supabase.from('agent_executions').insert({
              id: execution_id,
              agent_id,
              user_id: user.id,
              status: 'running',
              created_at: new Date().toISOString()
            })
          }

          // Process PDF if present
          for (const key in input_variables) {
            const value = input_variables[key]
            if (typeof value === 'string' && value.startsWith('data:application/pdf;base64,')) {
              console.log('PDF upload detected, extracting text content')
              const text = await extractPdfTextFromBase64(value)
              input_variables.__uploaded_file_text = text
              console.log(`PDF text extraction completed. Extracted ${text.length} characters`)
              break
            }
          }

          const startTime = Date.now()
          console.log('Starting agent execution with interpolated prompt')

          const interpolatedPrompt = await interpolatePrompt(user_prompt, input_variables, undefined, user.id)
          
          const { message, parsed_output, pluginContext, send_status } = await runAgentWithContext({
            supabase,
            agent,
            userId: user.id,
            input_variables,
            override_user_prompt: interpolatedPrompt,
          })

          const endTime = Date.now()
          const duration = endTime - startTime

          console.log(`Agent execution completed successfully in ${duration}ms`)

          // Update execution record
          if (execution_id) {
            await supabase.from('agent_executions').update({
              status: 'completed',
              duration_ms: duration,
              completed_at: new Date().toISOString()
            }).eq('id', execution_id)
          }

          // Send final result
          sendEvent({
            type: 'result',
            result: {
              message,
              parsed_output,
              pluginContext,
              send_status,
            },
            execution_time: duration
          })

          // Insert into agent_logs table (the main logging table)
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

          // Update agent stats
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

          sendEvent({ type: 'complete' })

        } catch (error: any) {
          console.error(`Critical error: ${error.message}`)
          
          if (execution_id) {
            await supabase.from('agent_executions').update({
              status: 'failed',
              completed_at: new Date().toISOString()
            }).eq('id', execution_id)
          }

          sendEvent({
            type: 'error',
            error: error.message
          })
        } finally {
          restoreConsole()
          controller.close()
        }
      }

      executeAgent()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}