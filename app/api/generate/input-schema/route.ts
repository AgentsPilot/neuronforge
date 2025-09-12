// /app/api/generate/input-schema/route.ts
import { NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export async function POST(req: Request) {
  const { prompt, plugins = [] } = await req.json()

  if (!prompt || typeof prompt !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid prompt' }, { status: 400 })
  }

  const pluginContext = plugins.length
    ? `The user has selected the following plugins: ${plugins.join(', ')}. Include fields that will help the agent interact with these plugins.`
    : `The user did not select any plugins. Suggest general inputs based on the agent's purpose.`

  const systemPrompt = `You are an assistant helping define input fields for an AI agent.
Based on the user prompt, return a JSON array of input fields the agent will require.
Each field should include: name, type (string | number | boolean | date | enum), and required (true/false).
If type is "enum", include an "enum" array.

Example:
[
  { "name": "emailSubject", "type": "string", "required": true },
  { "name": "startDate", "type": "date", "required": false },
  { "name": "category", "type": "enum", "enum": ["HR", "Finance", "IT"], "required": true }
]

Prompt: ${prompt}
${pluginContext}`

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.1,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
  })

  const responseText = completion.choices[0].message.content ?? '[]'

  try {
    const input_schema = JSON.parse(responseText)
    return NextResponse.json({ input_schema })
  } catch {
    return NextResponse.json({ input_schema: [] })
  }
}