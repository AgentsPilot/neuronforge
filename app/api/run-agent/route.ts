'use server'

import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: Request) {
  try {
    const body = await req.json()
    console.log('🟢 /api/run-agent called with:', body)

    const { user_prompt, system_prompt, user_id, agent_id } = body

    if (!user_prompt || !user_id || !agent_id) {
      console.error('❌ Missing required fields')
      return NextResponse.json(
        { error: 'Missing prompt, user_id or agent_id' },
        { status: 400 }
      )
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
  { role: 'system', content: system_prompt || '' },
  { role: 'user', content: user_prompt },
],
    })

    const output = completion.choices[0].message.content

    // Insert agent log
    const { error: logError } = await supabase.from('agent_logs').insert([
      {
        user_id,
        agent_id,
        user_prompt,
        output,
      },
    ])

    if (logError) {
      console.error('❌ Failed to insert log:', logError)
    }

    // Update agent_stats table
    const now = new Date().toISOString()
    const { error: statsError } = await supabase
      .from('agent_stats')
      .upsert(
        {
          agent_id,
          run_count: 1,
          success_count: 1,
          last_run_at: now,
        },
        {
          onConflict: 'agent_id',
          ignoreDuplicates: false,
          updateColumns: ['run_count', 'success_count', 'last_run_at'],
        }
      )

    if (statsError) {
      console.error('❌ Failed to update stats:', statsError)
    }

    return NextResponse.json({ result: output })
  } catch (err: any) {
    console.error('❌ Error in /api/run-agent:', err)
    console.error('❌ Full error (JSON):', JSON.stringify(err, null, 2))

    // Update agent_stats with failed run
    try {
      const body = await req.json()
      const { agent_id } = body

      if (agent_id) {
        const now = new Date().toISOString()
        await supabase.from('agent_stats').upsert(
          {
            agent_id,
            run_count: 1,
            last_run_at: now,
          },
          {
            onConflict: 'agent_id',
            ignoreDuplicates: false,
            updateColumns: ['run_count', 'last_run_at'],
          }
        )
      }
    } catch (e) {
      console.error('⚠️ Could not update stats on failure:', e)
    }

    return NextResponse.json(
      { error: err?.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}