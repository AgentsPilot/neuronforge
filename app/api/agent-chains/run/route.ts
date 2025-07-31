// app/api/agent-chains/run/route.ts
import { NextResponse } from 'next/server'
import { runAgentWithContext } from '@/lib/utils/runAgentWithContext'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export async function POST(req: Request) {
  const body = await req.json()
  const { chain_id, initial_input = {} } = body

  if (!chain_id) {
    return NextResponse.json({ error: 'Missing chain_id' }, { status: 400 })
  }

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

  const { data: chain, error: chainError } = await supabase
    .from('agent_chains')
    .select('*')
    .eq('id', chain_id)
    .eq('user_id', user.id)
    .single()

  if (chainError || !chain) {
    return NextResponse.json({ error: 'Agent chain not found' }, { status: 404 })
  }

  const steps = chain.steps || []
  let fullContext: Record<string, any> = { ...initial_input }
  const stepOutputs: Record<string, any> = {}
  const runResults: any[] = []

  for (const step of steps) {
    const { agent_id, alias, input_map = [] } = step

    const input_variables: Record<string, any> = {}

    for (const map of input_map) {
      const sourceStep = stepOutputs[map.from_step]
      if (sourceStep && sourceStep[map.from_field] !== undefined) {
        input_variables[map.field_name] = sourceStep[map.from_field]
      }
    }

    // Merge in global context (e.g., initial_input)
    const mergedInput = { ...fullContext, ...input_variables }

    try {
      const result = await runAgentWithContext({
        agent_id,
        input_variables: mergedInput,
        user_id: user.id,
        supabase,
      })

      runResults.push({ step: alias, ...result })

      // Save result under alias for use in downstream steps
      if (alias && result.parsed_output) {
        stepOutputs[alias] = result.parsed_output
        fullContext = { ...fullContext, ...result.parsed_output }
      }
    } catch (err: any) {
      return NextResponse.json(
        { error: `Step "${alias}" failed: ${err.message}` },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({ results: runResults })
}