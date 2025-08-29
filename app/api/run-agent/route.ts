// app/api/run-agent/route.ts

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { runAgentWithContext } from '@/lib/utils/runAgentWithContext'
import { extractPdfTextFromBase64 } from '@/lib/utils/extractPdfTextFromBase64'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const body = await req.json()
  const { agent_id, input_variables = {}, override_user_prompt } = body
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

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agent_id)
    .single()

  if (agentError || !agent) {
    console.error('❌ Agent fetch error:', agentError)
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
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
        const text = await extractPdfTextFromBase64(value)
        input_variables.__uploaded_file_text = text
        break // Only process the first PDF for now
      }
    }
  } catch (err) {
    console.error('❌ Failed to extract PDF text:', err)
  }

  try {
    const { message, parsed_output, pluginContext, send_status } = await runAgentWithContext({
      supabase,
      agent,
      userId: user.id,
      input_variables,
      override_user_prompt,
    })

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
    })
  } catch (err) {
    console.error('❌ runAgentWithContext error:', err)
    return NextResponse.json(
      { error: 'Failed to run agent using OpenAI' },
      { status: 500 }
    )
  }
}