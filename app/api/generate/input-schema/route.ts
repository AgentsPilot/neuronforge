// /app/api/generate/input-schema/route.ts
import { NextResponse } from 'next/server'
import { OpenAIProvider } from '@/lib/ai/providers/openaiProvider'
import { PromptLoader } from '@/app/api/types/PromptLoader'
import { createLogger } from '@/lib/logger'
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics'

const logger = createLogger({ module: 'API', route: '/api/generate/input-schema' })
const aiAgentPromptTemplate = 'generate-input-schema-chatgpt'

export async function POST(req: Request) {
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })
  const startTime = Date.now()

  requestLogger.info('Input schema generation request received')

  try {
    const { prompt, plugins = [], userId, sessionId, agentId } = await req.json()

    if (!prompt || typeof prompt !== 'string') {
      requestLogger.warn('Missing or invalid prompt')
      return NextResponse.json({ error: 'Missing or invalid prompt' }, { status: 400 })
    }

    requestLogger.debug({ prompt, plugins, userId }, 'Request parsed')

    // Build plugin context
    const pluginContext = plugins.length
      ? `The user has selected the following plugins: ${plugins.join(', ')}. Include fields that will help the agent interact with these plugins.`
      : `The user did not select any plugins. Suggest general inputs based on the agent's purpose.`

    // Load and prepare system prompt
    const promptLoader = new PromptLoader(aiAgentPromptTemplate)
    const systemPrompt = promptLoader.replaceKeywords({
      USER_PROMPT: prompt,
      PLUGIN_CONTEXT: pluginContext
    })

    requestLogger.debug({ promptLength: systemPrompt.length }, 'System prompt loaded')

    // Call OpenAI
    const aiAnalytics = new AIAnalyticsService()
    const openaiProvider = OpenAIProvider.getInstance(aiAnalytics)

    const completion = await openaiProvider.chatCompletion(
      {
        model: 'gpt-4o',
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' }
      },
      {
        userId: userId || 'anonymous',
        sessionId: sessionId || '',
        feature: 'input_schema_generation',
        component: 'generate-input-schema',
        category: 'agent_creation',
        activity_type: 'agent_creation',
        activity_name: 'Generating input schema for agent',
        activity_step: 'schema_generation',
        agent_id: agentId || ''
      }
    )

    const responseText = completion.choices[0].message.content ?? '[]'

    try {
      const input_schema = JSON.parse(responseText)
      const duration = Date.now() - startTime

      requestLogger.info(
        { schemaFieldCount: Array.isArray(input_schema) ? input_schema.length : 0, duration },
        'Input schema generated successfully'
      )

      return NextResponse.json({ input_schema })
    } catch (parseError: any) {
      requestLogger.error({ err: parseError, responseText }, 'Failed to parse AI response as JSON')
      return NextResponse.json({ input_schema: [], error: 'Failed to parse response' })
    }

  } catch (error: any) {
    const duration = Date.now() - startTime
    requestLogger.error({ err: error, duration }, 'Unexpected error in input schema generation')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}