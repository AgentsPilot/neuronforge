// app/api/generate-agent/finalize/route.ts

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import OpenAI from 'openai'
import { detectPluginsFromPrompt } from '@/lib/plugins/detectPluginsFromPrompt'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export async function POST(req: Request) {
  const { original_prompt, answers, selected_plugin, clarification_questions } = await req.json()
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

  const formattedAnswers = answers.map((a: string, i: number) => `Q${i + 1}: ${a}`).join('\n')

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are an AI assistant that creates agent specs for an agent-based automation platform.

Given a natural language user request and clarifying answers, return a JSON object with:
- agent_name
- user_prompt
- system_prompt
- description
- input_schema (array of fields: name, type, required)

Do NOT include auth-related fields like email/password.
Keep prompts professional and clean.`,
      },
      {
        role: 'user',
        content: `User prompt:
${original_prompt}

Answers to follow-up questions:
${formattedAnswers}`,
      },
    ],
    temperature: 0.1,
  })

  const raw = completion.choices[0]?.message?.content || ''

  let extracted
  try {
    extracted = JSON.parse(raw)
  } catch (e) {
    console.error('❌ Failed to parse LLM response:', raw)
    return NextResponse.json({ error: 'Failed to parse AI response.', raw }, { status: 500 })
  }

  const validPlugins = detectPluginsFromPrompt(original_prompt)

  // ✅ Only assign selected_plugin if it's also detected from the prompt
  const plugins =
    selected_plugin && validPlugins.includes(selected_plugin)
      ? [selected_plugin]
      : validPlugins

  const appendedSystemPrompt =
    clarification_questions && clarification_questions.length > 0
      ? `${extracted.system_prompt}\n\nClarification details:\n${clarification_questions
          .map((q, i) => `Q${i + 1}: ${q}`)
          .join('\n')}`
      : extracted.system_prompt

  const { data: newAgent, error } = await supabase
    .from('agents')
    .insert({
      user_id: user.id,
      agent_name: extracted.agent_name || 'Untitled Agent',
      user_prompt: extracted.user_prompt,
      system_prompt: appendedSystemPrompt || 'You are a helpful assistant.',
      description: extracted.description || '',
      plugins_required: plugins,
      input_schema: extracted.input_schema || [],
      output_schema: [],
      status: 'draft',
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ agent: newAgent })
}