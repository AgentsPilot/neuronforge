// app/api/run-agent/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

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

  const outputMessage = `✅ Agent "${agent.agent_name}" ran successfully.`

  // ✅ Insert into agent_logs
  await supabase.from('agent_logs').insert([
    {
      user_id: user.id,
      agent_id: agent.id,
      run_output: outputMessage,
    },
  ])

  return NextResponse.json({ result: { message: outputMessage } })
}