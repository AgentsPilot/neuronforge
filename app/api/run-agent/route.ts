// app/api/run-agent/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import OpenAI from 'openai'
import { interpolatePrompt } from '@/lib/utils/interpolatePrompt'
import { readInbox } from '@/lib/plugins/actions/gmail/readInbox'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

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

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('🔍 Running Gmail readInbox with user ID:', user.id) // ← ADD THIS

  const { data: agent, error } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agent_id)
    .eq('user_id', user.id)
    .single()

  if (error || !agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  // 🧠 Use override prompt or default
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

  // 🔄 Interpolate prompt using inputs and plugins
  const interpolatedPrompt = await interpolatePrompt(rawUserPrompt, input_variables, plugins, user.id)

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: interpolatedPrompt },
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
    }

    // ✅ Log to Supabase
    await supabase.from('agent_logs').insert([
      {
        user_id: user.id,
        agent_id: agent.id,
        run_output: outputMessage,
        full_output: JSON.stringify(fullResult),
      },
    ])

    // ✅ Update agent stats
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