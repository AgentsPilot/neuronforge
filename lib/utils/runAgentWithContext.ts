// lib/utils/runAgentWithContext.ts

import { pluginRegistry } from '@/lib/plugins/pluginRegistry'
import { detectPluginsFromPrompt } from '@/lib/plugins/detectPluginsFromPrompt'
import { interpolatePrompt } from '@/lib/utils/interpolatePrompt'
import { sendEmailDraft } from '@/lib/plugins/google-mail/sendEmailDraft'
import { extractPdfTextFromBase64 } from '@/lib/utils/extractPdfTextFromBase64' // ✅ ADDED
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

type RunAgentInput = {
  supabase: any
  agent: any
  userId: string
  input_variables: Record<string, any>
  override_user_prompt?: string
}

export async function runAgentWithContext({
  supabase,
  agent,
  userId,
  input_variables,
  override_user_prompt,
}: RunAgentInput) {
  if (!agent) throw new Error('Agent is undefined in runAgentWithContext')

  const rawUserPrompt = override_user_prompt || agent.user_prompt
let userPrompt = rawUserPrompt.trim()

// 👇 Append extracted PDF text if any

for (const key of Object.keys(input_variables)) {
  if (key.endsWith('Text') && typeof input_variables[key] === 'string') {
    const truncated = input_variables[key].slice(0, 3000)
    userPrompt += `\n\nThe user uploaded a document. Please extract the relevant information based on user prompt from this:\n\n"""${truncated}"""`
  }
}
const schemaReminder = agent.output_schema?.type === 'StructuredData'
    ? `\n\n⚠️ IMPORTANT: Your output MUST be valid JSON only. Do not include explanations. Match this format:\n${JSON.stringify(
        (agent.output_schema.fields || []).reduce((acc: any, f: any) => {
          acc[f.name] = f.type === 'number' ? 0 : 'string'
          return acc
        }, {}),
        null,
        2
      )}`
    : ''

  const systemPrompt = `You are an AI agent tasked with helping users complete business tasks using data from connected services and structured inputs.

User Goal: ${userPrompt}

Only use facts from the plugin context and input variables provided. If the requested result is not clearly supported by data, respond with: "No relevant data found for this request."

Never hallucinate. Respond precisely based on the provided data.${schemaReminder}`

  const { data: pluginConnections } = await supabase
    .from('plugin_connections')
    .select('*')
    .eq('user_id', userId)

  const plugins: Record<string, any> = {}
  pluginConnections?.forEach((conn) => {
    plugins[conn.plugin_key] = {
      access_token: conn.access_token,
      refresh_token: conn.refresh_token,
      username: conn.username,
      expires_at: conn.expires_at,
    }
  })

  const pluginContext: Record<string, string> = {}
  const requiredPlugins = agent.plugins_required || []

  for (const pluginKey of requiredPlugins) {
    const strategy = pluginRegistry[pluginKey]
    const creds = plugins[pluginKey]

    if (strategy?.run && creds) {
      try {
        if (
          strategy.refreshToken &&
          creds.expires_at &&
          new Date(creds.expires_at) < new Date()
        ) {
          const refreshed = await strategy.refreshToken(creds)
          creds.access_token = refreshed.access_token
          creds.expires_at = refreshed.expires_at
        }

        const result = await strategy.run({ connection: creds })
        let summary = typeof result === 'object' ? Object.values(result)[0] : String(result)
        if (summary.length > 3000) summary = summary.slice(0, 3000) + '\n...[truncated]'

        pluginContext[pluginKey] = summary
      } catch (err: any) {
        console.warn(`⚠️ Plugin ${pluginKey} run failed: ${err.message}`)
      }
    }
  }

  // ✅ Extract PDF text from uploaded base64-encoded files
  for (const key of Object.keys(input_variables)) {
    const value = input_variables[key]
    if (typeof value === 'string' && value.startsWith('data:application/pdf')) {
      try {
        const extractedText = await extractPdfTextFromBase64(value)
        console.log(`📄 Extracted text from ${key}:\n`, extractedText) // ✅ Add this line
        input_variables[`${key}Text`] = extractedText
        console.log(`📄 Extracted text from ${key} → ${key}Text`)
      } catch (err) {
        console.warn(`❌ Failed to extract PDF text from ${key}:`, err)
      }
    }
  }

  // Inject uploaded file text if manually included
  if (input_variables.__uploaded_file_text && typeof input_variables.__uploaded_file_text === 'string') {
    pluginContext['uploaded-file'] = input_variables.__uploaded_file_text
  }

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

  const contextString = [
    `\n\n[Input Variables]\n${JSON.stringify(input_variables, null, 2)}`,
    `\n\n[Plugin Context]\n${JSON.stringify(pluginContext, null, 2)}`,
  ].join('\n')

  const finalPrompt = `${interpolatedPrompt}\n${contextString}`

  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: finalPrompt },
    ],
    temperature: 0.3,
  })

  const message = completion.choices[0].message.content || 'No response.'
  let parsed_output: any = null
  let send_status: string | null = null

  let schemaType: string | undefined = undefined
  if (agent.output_schema && typeof agent.output_schema === 'object') {
    schemaType = agent.output_schema.type
  }

  if (schemaType === 'SummaryBlock') {
    parsed_output = { summary: message }
    send_status = 'Summary block logged.'
  } else if (schemaType === 'EmailDraft') {
    const { to, subject, includePdf } = agent.output_schema
    if (to && subject) {
      try {
        await sendEmailDraft({ userId, to, subject, body: message, includePdf })
        parsed_output = { to, subject, body: message }
        send_status = `📧 Email sent to ${to}.`
      } catch (e: any) {
        parsed_output = { to, subject, body: message }
        send_status = `❌ Failed to send email: ${e.message}`
      }
    } else {
      send_status = '❌ Missing "to" or "subject" in output schema for EmailDraft.'
    }
  } else if (schemaType === 'Alert') {
    const { title, message: messageTemplate, severity } = agent.output_schema
    if (title && messageTemplate && severity) {
      const alertMessage = Object.entries(input_variables).reduce((msg, [key, val]) => {
        return msg.replace(new RegExp(`{{\\s*input\\.${key}\\s*}}`, 'g'), val)
      }, messageTemplate)

      const keyword = input_variables['Alert on Word']?.toLowerCase()
      const pluginText = pluginContext['google-mail']?.toLowerCase() || ''
      const contradiction =
        message.toLowerCase().includes("didn't find") ||
        message.toLowerCase().includes('no alert has been sent')

      if (!keyword || !pluginText.includes(keyword) || contradiction) {
        parsed_output = { summary: message }
        send_status = `ℹ️ No alert sent. Condition not met.`
      } else {
        parsed_output = {
          type: 'Alert',
          title,
          message: alertMessage,
          severity,
        }
        send_status = `🚨 Alert generated: ${title}`
      }
    } else {
      send_status = '❌ Missing alert title, message, or severity in output schema.'
    }
  } else if (schemaType === 'StructuredData') {
    try {
      const parsed = JSON.parse(message)
      const missingFields = (agent.output_schema.fields || []).filter(
        (field: any) => field.required && !(field.name in parsed)
      ).map((field: any) => field.name)

      if (missingFields.length > 0) {
        send_status = `❌ Missing required fields: ${missingFields.join(', ')}`
      } else {
        parsed_output = parsed
        send_status = '✅ Structured data parsed successfully.'
      }
    } catch (err: any) {
      send_status = `❌ Failed to parse structured output as JSON: ${err.message}`
    }
  } else {
    send_status = 'No structured output configured.'
  }

  return {
    message,
    pluginContext,
    parsed_output,
    send_status,
  }
}