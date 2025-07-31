// /app/api/agent-chains/run.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { runAgent } from '@/lib/utils/runAgentWithContext'

export async function POST(req: Request) {
  const body = await req.json()
  const { chain_id, initial_input = {} } = body

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

  const { data: chain, error } = await supabase
    .from('agent_chains')
    .select('*')
    .eq('id', chain_id)
    .eq('user_id', user.id)
    .single()

  if (error || !chain) {
    return NextResponse.json({ error: 'Chain not found' }, { status: 404 })
  }

  const agentIds: string[] = chain.agent_ids || []
  let context = initial_input
  const executionLog: any[] = []

  for (const agentId of agentIds) {
    try {
      const { result, error } = await runAgent({
        agent_id: agentId,
        input_variables: context,
        user_id: user.id,
        supabase,
      })

      if (error) {
        return NextResponse.json({ error: `Agent ${agentId} failed: ${error}` }, { status: 500 })
      }

      context = result?.parsed_output || {}
      executionLog.push({ agentId, result })
    } catch (err: any) {
      return NextResponse.json({ error: `Chain execution error: ${err.message}` }, { status: 500 })
    }
  }

  return NextResponse.json({ chain_id, executionLog, final_output: context })
}