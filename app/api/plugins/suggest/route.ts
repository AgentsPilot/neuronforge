// /app/api/plugins/suggest/route.ts

import { NextResponse } from 'next/server'
import { ProviderFactory, PROVIDERS } from '@/lib/ai/providerFactory'
import { OPENAI_MODELS } from '@/lib/ai/providers/openaiProvider'
import type { CallContext } from '@/lib/ai/providers/baseProvider'
import { pluginList } from '@/lib/plugins/pluginList'

// ProviderFactory handles LLM client initialization - no direct SDK instantiation needed

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

  // Get provider from factory for centralized token tracking
  const provider = ProviderFactory.getProvider(PROVIDERS.OPENAI)
  const context: CallContext = {
    userId: 'system',
    feature: 'plugins',
    component: 'suggest',
    category: 'plugin_suggestion',
    activity_type: 'plugin_recommendation',
    activity_name: 'suggest_plugins',
  }

  const completion = await provider.chatCompletion({
    model: OPENAI_MODELS.GPT_4O,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    temperature: 0.1,
  }, context)

  // ProviderFactory returns OpenAI-compatible format
  const responseText = completion.choices?.[0]?.message?.content ?? '[]'

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