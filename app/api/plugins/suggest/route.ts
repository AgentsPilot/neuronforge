// /app/api/plugins/suggest/route.ts

import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { pluginList } from '@/lib/plugins/pluginList'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export async function POST(req: Request) {
  const { prompt } = await req.json()

  // Dynamically format plugin list for GPT
  const formattedList = pluginList
    .map((p) => `- ${p.pluginKey}: ${p.description}`)
    .join('\n')

  const systemPrompt = `You are an assistant that helps users connect relevant plugins to their AI agent.
Given the user's natural language request, choose the most relevant plugins from the following list.

Return only the plugin keys.

Plugin List:
${formattedList}

Respond ONLY with a JSON array of plugin keys from the list above.
Example: ["google-mail", "notion"]`

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    temperature: 0.1,
  })

  const responseText = completion.choices[0].message.content ?? '[]'

  let pluginsFromGPT: string[] = []
  try {
    pluginsFromGPT = JSON.parse(responseText)
  } catch {
    pluginsFromGPT = []
  }

  // ✅ Fallback logic: add email plugins if prompt includes relevant keywords
  const lowerPrompt = prompt.toLowerCase()
  const fallbackPlugins: string[] = []

  if (lowerPrompt.includes('email') || lowerPrompt.includes('inbox') || lowerPrompt.includes('google-mail') || lowerPrompt.includes('outlook')) {
    fallbackPlugins.push('google-mail', 'outlook')
  }

  // ✅ Merge GPT result with fallback (remove duplicates)
  const plugins = Array.from(new Set([...pluginsFromGPT, ...fallbackPlugins]))

  return NextResponse.json({ plugins })
}