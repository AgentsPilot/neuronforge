import { pluginRegistry } from '@/lib/plugins/pluginRegistry'
import { detectPluginsFromPrompt } from '@/lib/plugins/detectPluginsFromPrompt'
import { interpolatePrompt } from '@/lib/utils/interpolatePrompt'
import { sendEmailDraft } from '@/lib/plugins/google-mail/sendEmailDraft'
import { extractPdfTextFromBase64 } from '@/lib/utils/extractPdfTextFromBase64'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

type RunAgentInput = {
  supabase: any
  agent: any
  userId: string
  input_variables: Record<string, any>
  override_user_prompt?: string
}

// Handle email output using existing sendEmailDraft function
async function handleEmailOutput(agent: any, responseMessage: string, pluginContext: any, userId: string) {
  if (agent.output_schema?.type === 'EmailDraft') {
    try {
      console.log('Processing EmailDraft output schema:', agent.output_schema)
      
      const outputSchema = agent.output_schema
      const emailTo = outputSchema.to
      const emailSubject = outputSchema.subject || 'Email Summary'
      const includePdf = outputSchema.includePdf || false
      
      console.log('Sending email to:', emailTo, 'with PDF:', includePdf)
      
      const emailResult = await sendEmailDraft({
        userId,
        to: emailTo,
        subject: emailSubject,
        body: responseMessage,
        includePdf
      })
      
      return {
        message: responseMessage,
        pluginContext,
        parsed_output: { 
          summary: responseMessage,
          emailSent: true,
          emailTo: emailTo,
          pdfGenerated: includePdf,
          emailId: emailResult.id
        },
        send_status: `Email sent to ${emailTo}${includePdf ? ' with PDF attachment' : ''}`,
      }
      
    } catch (error) {
      console.error('Email sending failed:', error)
      return {
        message: responseMessage,
        pluginContext,
        parsed_output: { 
          summary: responseMessage, 
          emailError: error.message,
          emailSent: false 
        },
        send_status: `Email failed: ${error.message}`,
      }
    }
  }
  
  return {
    message: responseMessage,
    pluginContext: {},
    parsed_output: { summary: responseMessage },
    send_status: 'Agent completed successfully.',
  }
}

export async function runAgentWithContext({
  supabase,
  agent,
  userId,
  input_variables,
  override_user_prompt,
}: RunAgentInput) {
  if (!agent) throw new Error('Agent is undefined in runAgentWithContext')

  console.log('DEBUG: Starting runAgentWithContext', {
    agentId: agent.id,
    agentName: agent.agent_name,
    pluginsRequired: agent.plugins_required,
    userId: userId,
    inputVariables: Object.keys(input_variables),
    outputSchema: agent.output_schema
  })

  const rawUserPrompt = override_user_prompt || agent.user_prompt
  let userPrompt = rawUserPrompt.trim()

  for (const key of Object.keys(input_variables)) {
    if (key.endsWith('Text') && typeof input_variables[key] === 'string') {
      const truncated = input_variables[key].slice(0, 3000)
      userPrompt += `\n\nThe user uploaded a document. Please extract the relevant information based on user prompt from this:\n\n\"\"\"${truncated}\"\"\"`
    }
  }

  const schemaReminder =
    agent.output_schema?.type === 'StructuredData'
      ? `\n\n⚠️ IMPORTANT: Your output MUST be valid JSON only. Do not include explanations. Match this format:\n${JSON.stringify(
          (agent.output_schema.fields || []).reduce((acc: any, f: any) => {
            acc[f.name] = f.type === 'number' ? 0 : 'string'
            return acc
          }, {}),
          null,
          2
        )}`
      : ''

  // Get user's plugin connections
  const { data: pluginConnections, error: pluginError } = await supabase
    .from('plugin_connections')
    .select('*')
    .eq('user_id', userId)

  console.log('DEBUG: Plugin connections query', {
    userId,
    connectionsFound: pluginConnections?.length || 0,
    connections: pluginConnections?.map(c => ({ plugin_key: c.plugin_key, username: c.username, expires_at: c.expires_at })),
    error: pluginError
  })

  const plugins: Record<string, any> = {}
  pluginConnections?.forEach((conn) => {
    plugins[conn.plugin_key] = {
      access_token: conn.access_token,
      refresh_token: conn.refresh_token,
      username: conn.username,
      expires_at: conn.expires_at,
    }
  })

  console.log('DEBUG: Available plugins vs Required', {
    availableInRegistry: Object.keys(pluginRegistry),
    requiredByAgent: agent.plugins_required || [],
    userConnectedPlugins: Object.keys(plugins),
    registryHasRunFunction: Object.keys(pluginRegistry).map(key => ({
      key,
      hasRun: typeof pluginRegistry[key]?.run === 'function',
      hasConnect: typeof pluginRegistry[key]?.connect === 'function'
    }))
  })

  const pluginContext: Record<string, any> = {}
  const requiredPlugins = agent.plugins_required || []

  for (const pluginKey of requiredPlugins) {
    console.log(`DEBUG: Processing plugin: ${pluginKey}`)
    
    const strategy = pluginRegistry[pluginKey]
    let creds = plugins[pluginKey]

    // Special handling for ChatGPT Research - it doesn't need user credentials
    if (pluginKey === 'chatgpt-research') {
      creds = {
        access_token: 'platform-key', // Uses your platform's OpenAI API key
        refresh_token: null,
        username: 'ChatGPT',
        expires_at: null
      }
      console.log(`DEBUG: Using platform credentials for ChatGPT Research`)
    }

    console.log(`DEBUG: Plugin ${pluginKey} status:`, {
      hasStrategy: !!strategy,
      hasCreds: !!creds,
      strategyHasRun: !!strategy?.run,
      strategyHasConnect: !!strategy?.connect,
      credDetails: creds ? {
        hasAccessToken: !!creds.access_token,
        hasRefreshToken: !!creds.refresh_token,
        username: creds.username,
        expiresAt: creds.expires_at
      } : 'No credentials found'
    })

    if (!strategy) {
      console.error(`Plugin ${pluginKey} not found in registry`)
      pluginContext[pluginKey] = {
        summary: "Plugin not found in registry",
        error: `Plugin ${pluginKey} is not registered`
      }
      continue
    }

    if (!creds) {
      console.error(`No credentials found for plugin ${pluginKey}`)
      pluginContext[pluginKey] = {
        summary: "User has not connected this service",
        error: `No connection found for ${pluginKey}`
      }
      continue
    }

    if (!strategy.run) {
      console.error(`Plugin ${pluginKey} has no run function`)
      pluginContext[pluginKey] = {
        summary: "Plugin does not support data fetching",
        error: `Plugin ${pluginKey} has connect function but no run function for data fetching`
      }
      continue
    }

    try {
      const now = new Date()
      const expires = creds.expires_at ? new Date(creds.expires_at) : null
      const isExpired = expires && expires.getTime() < now.getTime()

      console.log(`Token check for plugin ${pluginKey}:`, {
        now: now.toISOString(),
        expires_at: creds.expires_at,
        isExpired,
      })

      // Skip token refresh for ChatGPT Research as it uses platform credentials
      if (isExpired && strategy.refreshToken && pluginKey !== 'chatgpt-research') {
        console.log(`Token expired for ${pluginKey}. Refreshing...`)
        const refreshed = await strategy.refreshToken(creds)
        creds.access_token = refreshed.access_token
        creds.expires_at = refreshed.expires_at
        console.log(`Token refreshed for ${pluginKey}`)

        await supabase
          .from('plugin_connections')
          .update({
            access_token: refreshed.access_token,
            expires_at: refreshed.expires_at
          })
          .eq('user_id', userId)
          .eq('plugin_key', pluginKey)
      }

      console.log(`Running plugin ${pluginKey}...`)
      const result = await strategy.run({
        connection: creds,
        userId,
        input_variables,
      })

      console.log(`Plugin ${pluginKey} result:`, {
        resultType: typeof result,
        resultKeys: typeof result === 'object' ? Object.keys(result) : 'not object',
        resultPreview: typeof result === 'string' ? result.substring(0, 200) : result
      })

      pluginContext[pluginKey] = result
    } catch (err: any) {
      console.error(`Plugin ${pluginKey} execution failed:`, {
        error: err.message,
        stack: err.stack?.split('\n').slice(0, 5).join('\n'),
        errorType: err.constructor.name
      })
      
      pluginContext[pluginKey] = {
        summary: "Plugin execution failed",
        error: err.message,
        errorType: err.constructor.name
      }
    }
  }

  console.log('DEBUG: Final plugin context:', {
    pluginKeys: Object.keys(pluginContext),
    contextSummary: Object.entries(pluginContext).map(([key, value]) => ({
      plugin: key,
      hasData: typeof value === 'object' && !value.error,
      hasError: typeof value === 'object' && !!value.error,
      preview: typeof value === 'object' && value.summary ? value.summary.substring(0, 100) : 'No summary'
    }))
  })

  // Handle PDF uploads
  for (const key of Object.keys(input_variables)) {
    const value = input_variables[key]
    if (typeof value === 'string' && value.startsWith('data:application/pdf')) {
      try {
        const extractedText = await extractPdfTextFromBase64(value)
        console.log(`Extracted text from ${key}:\n`, extractedText.substring(0, 200) + '...')
        input_variables[`${key}Text`] = extractedText
      } catch (err) {
        console.warn(`Failed to extract PDF text from ${key}:`, err)
      }
    }
  }

  if (
    input_variables.__uploaded_file_text &&
    typeof input_variables.__uploaded_file_text === 'string'
  ) {
    pluginContext['uploaded-file'] = input_variables.__uploaded_file_text
  }

  // Truncate large input variables
  Object.keys(input_variables).forEach((key) => {
    if (typeof input_variables[key] === 'string' && input_variables[key].length > 500) {
      input_variables[key] = input_variables[key].slice(0, 500) + '... [truncated]'
    }
  })

  const interpolatedPrompt = await interpolatePrompt(
    userPrompt,
    input_variables,
    plugins,
    userId,
    agent.plugins_required || []
  )

  // Create flexible system prompt based on available context
  const hasPluginData = Object.keys(pluginContext).length > 0 && Object.values(pluginContext).some(ctx => typeof ctx === 'object' && !ctx.error)
  const hasInputData = Object.keys(input_variables).length > 0

  let systemPrompt = `You are an AI agent designed to help users with their tasks. `

  if (hasPluginData || hasInputData) {
    systemPrompt += `You have access to the following information:\n\n`
    
    if (hasInputData) {
      systemPrompt += `Input Data: Use the provided input variables to customize your response.\n`
    }
    
    if (hasPluginData) {
      systemPrompt += `Plugin Data: Use the connected service data when relevant to provide accurate, real-time information.\n`
    }
    
    systemPrompt += `\nPrioritize using this provided data when answering the user's request.`
  } else {
    systemPrompt += `No external data sources are connected. Use your general knowledge to provide helpful information. For real-time data requests, mention that connecting relevant plugins would provide more current information.`
  }

  systemPrompt += `\n\nUser Request: ${userPrompt}\n\nBe helpful, accurate, and direct in your response.${schemaReminder}`

  const contextString = [
    `\n\n[Input Variables]\n${JSON.stringify(input_variables, null, 2)}`,
    `\n\n[Plugin Context]\n${JSON.stringify(pluginContext, null, 2)}`,
  ].join('\n')

  const finalPrompt = `${interpolatedPrompt}\n${contextString}`

  console.log('Plugin context summary before LLM:', 
    Object.keys(pluginContext).length > 0 
      ? Object.keys(pluginContext).map(key => `${key}: ${pluginContext[key].error ? 'ERROR' : 'SUCCESS'}`).join(', ')
      : 'No plugins configured'
  )
  
  if (finalPrompt.length < 2000) {
    console.log('Final prompt sent to OpenAI:\n', finalPrompt)
  } else {
    console.log('Final prompt length:', finalPrompt.length, 'chars (too long to log)')
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: finalPrompt },
      ],
      temperature: 0.3,
    })

    const responseMessage = completion.choices[0]?.message?.content || 'No response.'
    console.log('OpenAI response preview:', responseMessage.substring(0, 200) + '...')

    return await handleEmailOutput(agent, responseMessage, pluginContext, userId)
  } catch (error: any) {
    if (error?.status === 429) {
      console.warn('GPT-4o quota exceeded. Falling back to GPT-3.5-turbo.')

      const fallback = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: finalPrompt },
        ],
        temperature: 0.3,
      })

      const responseMessage = fallback.choices[0]?.message?.content || 'No response.'
      return await handleEmailOutput(agent, responseMessage, pluginContext, userId)
    }

    console.error('OpenAI runAgentWithContext failed:', error)
    throw error
  }
}