// /app/api/orchestration/generate-steps/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { ProviderFactory, PROVIDERS } from '@/lib/ai/providerFactory'
import { OPENAI_MODELS } from '@/lib/ai/providers/openaiProvider'
import type { CallContext } from '@/lib/ai/providers/baseProvider'

// ProviderFactory handles LLM client initialization - no direct SDK instantiation needed

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

    // Get provider from factory for centralized token tracking
    const provider = ProviderFactory.getProvider(PROVIDERS.OPENAI)
    const context: CallContext = {
      userId: 'system',
      feature: 'orchestration',
      component: 'generate-steps',
      category: 'workflow_generation',
      activity_type: 'step_generation',
      activity_name: 'generate_workflow_steps',
    }

    const aiRes = await provider.chatCompletion({
      model: OPENAI_MODELS.GPT_4O,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 800,
    }, context)

    // ProviderFactory returns OpenAI-compatible format
    const content = aiRes.choices?.[0]?.message?.content?.trim()

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