// app/api/run-agent/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import OpenAI from 'openai'
import { interpolatePrompt } from '@/lib/utils/interpolatePrompt'
import { detectPluginsFromPrompt } from '@/lib/plugins/detectPluginsFromPrompt'
import { pluginRegistry } from '@/lib/plugins/pluginRegistry'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

export async function POST(req: Request) {
  const body = await req.json()
  let { agent_id, input_variables = {}, override_user_prompt } = body
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

  const { data: agent, error } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agent_id)
    .eq('user_id', user.id)
    .single()

  if (error || !agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const rawUserPrompt = override_user_prompt || agent.user_prompt
  const systemPrompt = agent.system_prompt || 'You are a helpful assistant.'

  // 📦 Fetch plugin connections
  const { data: pluginConnections } = await supabase
    .from('plugin_connections')
    .select('*')
    .eq('user_id', user.id)

  const plugins: Record<string, any> = {}
  pluginConnections?.forEach((conn) => {
    plugins[conn.plugin_key] = {
      access_token: conn.access_token,
      refresh_token: conn.refresh_token,
      username: conn.username,
      expires_at: conn.expires_at,
    }
  })

  // 🔍 Detect plugins & inject context
  const detectedPlugins = detectPluginsFromPrompt(rawUserPrompt)
  const pluginContext: Record<string, string> = {}

  for (const pluginKey of detectedPlugins) {
    const strategy = pluginRegistry[pluginKey]
    const creds = plugins[pluginKey]

    if (strategy?.run && creds) {
      try {
        if (strategy.refreshToken && creds.expires_at && new Date(creds.expires_at) < new Date()) {
          const refreshed = await strategy.refreshToken(creds)
          creds.access_token = refreshed.access_token
          creds.expires_at = refreshed.expires_at
        }

        const result = await strategy.run({ connection: creds, options: input_variables })
        let summary = typeof result === 'object' ? Object.values(result)[0] : String(result)

        // ✂️ Truncate long plugin context
        if (summary.length > 3000) {
          summary = summary.slice(0, 3000) + '\n...[truncated]'
        }

        pluginContext[pluginKey] = summary
      } catch (err: any) {
        console.warn(`⚠️ Plugin ${pluginKey} run failed: ${err.message}`)
      }
    } else {
      console.warn(`⚠️ No credentials found for plugin: ${pluginKey}`)
    }
  }

  // ✂️ Truncate overly long input values
  Object.keys(input_variables).forEach((key) => {
    if (typeof input_variables[key] === 'string' && input_variables[key].length > 500) {
      input_variables[key] = input_variables[key].slice(0, 500) + '... [truncated]'
    }
  })

  // 🧠 Interpolate prompt
  const interpolatedPrompt = await interpolatePrompt(
    rawUserPrompt,
    input_variables,
    plugins,
    user.id
  )

  // 🧩 Append plugin context as structured sections
  const contextString = Object.entries(pluginContext)
    .map(([key, value]) => `\n\n[Plugin: ${key}]\n${value}`)
    .join('')

  const finalPrompt = `${interpolatedPrompt}${contextString}`

  try {
    console.log('🧠 Final Prompt Sent to OpenAI:\n', finalPrompt)
    console.log('📝 Input Form Data:', input_variables)
    console.log('📋 Input Schema:', agent.input_schema)
    console.log('🔌 Plugin Context:', pluginContext)

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: finalPrompt },
      ],
      temperature: 0.7,
    })

    const message = completion.choices[0].message.content || 'No response.'
    const outputMessage = `✅ Agent "${agent.agent_name}" ran successfully.`

    const fullResult = {
      message,
      agent_id: agent.id,
      agent_name: agent.agent_name,
      timestamp: new Date().toISOString(),
      input_variables,
      plugins,
      plugin_context: pluginContext,
    }

    await supabase.from('agent_logs').insert([
      {
        user_id: user.id,
        agent_id: agent.id,
        run_output: outputMessage,
        full_output: JSON.stringify(fullResult),
      },
    ])

    await supabase.rpc('update_agent_stats', {
      p_agent_id: agent.id,
      p_user_id: user.id,
    })

    return NextResponse.json({ result: fullResult })
  } catch (err) {
    console.error('❌ OpenAI error:', err)
    return NextResponse.json({ error: 'Failed to run agent using OpenAI' }, { status: 500 })
  }
}