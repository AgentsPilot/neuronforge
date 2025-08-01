// /app/api/orchestration/generate-steps/route.ts

import { NextRequest, NextResponse } from 'next/server'

// 1. You need the OpenAI SDK
import OpenAI from 'openai'

// 2. Init OpenAI with your key (from .env.local)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(req: NextRequest) {
  try {
    const { processDescription } = await req.json()

    if (!processDescription || typeof processDescription !== 'string') {
      return NextResponse.json({ error: 'Missing processDescription' }, { status: 400 })
    }

    // 3. Craft prompt for best results
    const prompt = `
You are an expert business process automation architect.
Given the following business process description, break it down into 3-6 high-level steps.
For each step, suggest the most suitable AI agent or tool (e.g., Document Parser, Data Validator, Email Notifier, etc), describe the step, and list key inputs and outputs.

Respond in strict JSON format as an array named "steps", each with:
- id (number)
- title (string)
- description (string)
- suggestedAgent (string)
- inputs (array of strings)
- outputs (array of strings)

Process description:
${processDescription}

Respond only with the JSON array, no text before or after.
    `.trim()

    const aiRes = await openai.chat.completions.create({
      model: 'gpt-4o', // or 'gpt-3.5-turbo'
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 800,
    })

    // Extract the AI response text
    const content = aiRes.choices[0]?.message?.content?.trim()

    // Parse JSON result
    let steps
    try {
      steps = JSON.parse(content)
    } catch (e) {
      // Sometimes GPT wraps in ```json ... ```
      const match = content?.match(/```json\n([\s\S]+?)```/)
      if (match) {
        steps = JSON.parse(match[1])
      } else {
        throw new Error('Failed to parse steps from GPT response')
      }
    }

    return NextResponse.json({ steps })
  } catch (err: any) {
    console.error('AI generation error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}