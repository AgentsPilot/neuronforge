// ✅ /app/api/agent/generate-input-schema/route.ts
import { NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export async function POST(req: Request) {
  const { userPrompt, plugins } = await req.json()

  const pluginContext = plugins?.length
    ? `The user has selected the following plugins: ${plugins.join(', ')}.`
    : 'The user has not selected any plugins.'

  const systemPrompt = `You are an assistant that helps generate input fields for a custom AI agent.
Given the user's goal and the selected plugins, return a JSON array of input fields the user should configure.
Each field must include: name, type (string, number, boolean, enum), required (true/false).
Only include fields that are relevant to the task and plugins.

Format:
[
  { "name": "email_subject", "type": "string", "required": true },
  { "name": "priority", "type": "enum", "required": false, "options": ["low", "medium", "high"] }
]

${pluginContext}`

  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    temperature: 0.3,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })

  try {
    const content = completion.choices[0].message.content ?? '[]'
    const fields = JSON.parse(content)
    return NextResponse.json({ schema: fields })
  } catch (err) {
    return NextResponse.json({ schema: [] })
  }
}