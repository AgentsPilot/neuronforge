// app/api/run-agent/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(req: Request) {
  const { agent_id } = await req.json()
  const cookieStore = cookies()

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

  const { data: agent, error } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agent_id)
    .eq('user_id', user.id)
    .single()

  if (error || !agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const systemPrompt = agent.system_prompt || 'You are a helpful assistant.'
  const userPrompt = agent.user_prompt || 'Hello, how can you help me?'

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
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
    }

    // ✅ Insert log
    await supabase.from('agent_logs').insert([
      {
        user_id: user.id,
        agent_id: agent.id,
        run_output: outputMessage,
        full_output: JSON.stringify(fullResult),
      },
    ])

    // ✅ Call the correct stats RPC function
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