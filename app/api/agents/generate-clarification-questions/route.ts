import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
})

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const clarifyPromptSystemPrompt = `
You are a clarification assistant for AgentPilot, a no-code AI agent builder.

Your job is to help non-technical users complete their automation idea by asking **2–5 simple clarification questions** — only if needed.

---

🎯 GOAL:

The user's request will be turned into an AI agent that:
- Uses one or more connected plugins (e.g. Gmail, Notion, Slack)
- Runs once, on a schedule, or when triggered
- Performs an action like reading, summarizing, or notifying
- Delivers output via email, screen, file, or another plugin

---

🧠 Your job is to ask just enough clarification questions to fill in this sentence:

> “This agent will run on _(schedule)_ to use _(plugin or data source)_ and act on _(filters or conditions)_ then produce _(output type)_ and deliver it via _(destination)_.”

Ask about what’s missing — but only what’s missing.

---

🛠 FORMAT:

Return a JSON array of 2–5 objects. Each object must include:
- \`question\` (string)
- \`type\` (string) – one of: "text", "textarea", "select", "multiselect", "enum", "date"
- \`options\` (array of strings) – required if \`type\` is "select", "multiselect", or "enum"

---

✅ EXAMPLES:

[
  {
    "question": "Which plugin should the agent use to get updates?",
    "type": "select",
    "options": ["Notion", "Slack", "Google Docs"]
  },
  {
    "question": "What kind of updates or tasks should the agent monitor?",
    "type": "text"
  },
  {
    "question": "How often should the agent run?",
    "type": "select",
    "options": ["One-time", "Every hour", "Every day", "Weekly", "When something changes"]
  },
  {
    "question": "Where should the result be delivered?",
    "type": "select",
    "options": ["Email me", "Save to Google Drive", "Show on screen", "Send to Slack"]
  }
]

---

⚠️ RULES:

❌ Do NOT ask about technical terms like “schema”, “API”, “input/output keys”  
❌ Do NOT ask about plugins that are NOT in \`connected_plugins[]\`  
❌ Do NOT return questions without \`type\`  
❌ For structured types, \`options[]\` MUST have 2+ choices  
❌ Do NOT return markdown, explanation, or comments — only raw JSON array

✅ Ask only what’s needed to complete the sentence above.
If the user prompt clearly defines all parts, you may return an empty array.
`

interface ClarificationQuestion {
  id: string
  question: string
  placeholder?: string
  required?: boolean
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'enum' | 'date'
  options?: string[]
}

interface ClarificationResponse {
  questions: ClarificationQuestion[]
  reasoning: string
  confidence: number
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { original_prompt, agent_name, description, user_id } = body

    if (!original_prompt?.trim() || !user_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // 🔌 Get connected plugins
    const { data: connections, error } = await supabase
      .from('plugin_connections')
      .select('plugin_key')
      .eq('user_id', user_id)
      .eq('status', 'active')

    if (error) console.error('🔌 Plugin fetch error:', error)

    const pluginKeys = connections?.map(c => c.plugin_key) || []
    const contextMessage = `
user_prompt: "${original_prompt}"
connected_plugins: ${JSON.stringify(pluginKeys)}
agent_name: "${agent_name || 'Not specified'}"
description: "${description || 'Not provided'}"

Return 2–5 clarification questions using JSON array format.
Only return zero questions if the user's request is 100% explicit about:
- plugin
- input
- output
- schedule

DO NOT include questions without "type".
DO NOT include "select" or "enum" questions without valid options.
`

    const llmResponse = await callOpenAI(contextMessage)
    const clarificationData = await parseAndValidateLLMResponse(llmResponse)

    // 🔒 Log analytics
    try {
      await supabase.from('clarification_analytics').insert([{
        user_id,
        original_prompt,
        agent_name,
        description,
        connected_plugins: pluginKeys,
        generated_questions: clarificationData.questions,
        questions_count: clarificationData.questions.length,
        generated_at: new Date().toISOString()
      }])
    } catch (logErr) {
      console.error('📊 Failed to log analytics:', logErr)
    }

    return NextResponse.json(clarificationData)

  } catch (err) {
    console.error('❌ Clarification POST error:', err)
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
  }
}

async function callOpenAI(context: string): Promise<any[]> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: clarifyPromptSystemPrompt },
        { role: 'user', content: context }
      ],
      temperature: 0.3,
      max_tokens: 1000
    })

    const content = completion.choices[0]?.message?.content || '[]'
    return JSON.parse(content)

  } catch (e) {
    console.error('🧠 OpenAI call failed:', e)
    return []
  }
}

async function parseAndValidateLLMResponse(llmResponse: any[]): Promise<ClarificationResponse> {
  try {
    const questions: ClarificationQuestion[] = llmResponse
      .map((q, i) => {
        const type = q.type?.toLowerCase()
        const needsOptions = ['select', 'enum', 'multiselect'].includes(type)

        if (!q.question || !type) return null
        if (needsOptions && (!Array.isArray(q.options) || q.options.length < 2)) return null

        return {
          id: `question_${i + 1}`,
          question: q.question.trim(),
          placeholder: 'Enter your answer...',
          required: true,
          type,
          options: needsOptions ? q.options : undefined
        }
      })
      .filter(Boolean)

    if (!questions.length) {
      return {
        questions: [
          {
            id: 'fallback_1',
            question: 'What kind of data should the agent use as input?',
            type: 'text'
          },
          {
            id: 'fallback_2',
            question: 'How should the result be delivered?',
            type: 'select',
            options: ['Email', 'Show on screen', 'Save to file', 'Other']
          }
        ],
        reasoning: 'Fallback questions used — LLM returned invalid or empty set.',
        confidence: 40
      }
    }

    return {
      questions: questions.slice(0, 5),
      reasoning: `Generated ${questions.length} structured clarification question${questions.length === 1 ? '' : 's'}.`,
      confidence: 85
    }

  } catch (e) {
    console.error('🛑 Validation error:', e)
    return {
      questions: [],
      reasoning: 'Clarification validation failed.',
      confidence: 50
    }
  }
}