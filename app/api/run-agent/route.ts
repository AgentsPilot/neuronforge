import { NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: Request) {
  try {
    const body = await req.json()
    console.log('🟢 /api/run-agent called with:', body)

    const { prompt } = body

    if (!prompt) {
      console.error('❌ Missing prompt')
      return NextResponse.json({ error: 'Missing prompt' }, { status: 400 })
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
    })

    return NextResponse.json({ result: completion.choices[0].message.content })
  } catch (err: any) {
    console.error('❌ Error in /api/run-agent:', err)
    console.error('❌ Full error (JSON):', JSON.stringify(err, null, 2))
    return NextResponse.json(
      { error: err?.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}