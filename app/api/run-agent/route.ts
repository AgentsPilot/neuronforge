import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Needs Service Role key for server writes
)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: Request) {
  try {
    const body = await req.json()
    console.log('🟢 /api/run-agent called with:', body)

    const { prompt, user_id, agent_id } = body

    if (!prompt || !user_id || !agent_id) {
      console.error('❌ Missing required fields')
      return NextResponse.json(
        { error: 'Missing prompt, user_id or agent_id' },
        { status: 400 }
      )
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
    })

    const output = completion.choices[0].message.content

    // Log to Supabase
    const { error } = await supabase.from('agent_logs').insert([
      {
        user_id,
        agent_id,
        prompt,
        output,
      },
    ])

    if (error) {
      console.error('❌ Failed to insert log:', error)
    }

    return NextResponse.json({ result: output })
  } catch (err: any) {
    console.error('❌ Error in /api/run-agent:', err)
    console.error('❌ Full error (JSON):', JSON.stringify(err, null, 2))
    return NextResponse.json(
      { error: err?.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}