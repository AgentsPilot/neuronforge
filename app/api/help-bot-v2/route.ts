// app/api/help-bot-v2/route.ts
// Self-learning support bot with FAQ → Cache → Groq fallback architecture

import { NextRequest, NextResponse } from 'next/server'
import { GroqProvider } from '@/lib/ai/providers/groqProvider'
import { createClient } from '@supabase/supabase-js'
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics'
import { UrlParserService } from '@/lib/utils/UrlParserService'
import { SystemConfigService } from '@/lib/services/SystemConfigService'
import { EmbeddingService } from '@/lib/services/EmbeddingService'
import * as fs from 'fs'
import * as path from 'path'
import crypto from 'crypto'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const aiAnalytics = new AIAnalyticsService(supabase)

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize question for consistent hashing and matching
 */
function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')     // Normalize whitespace
}

/**
 * Generate SHA256 hash of normalized question
 */
function hashQuestion(question: string): string {
  const normalized = normalizeQuestion(question)
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

/**
 * Search for agents by name (fuzzy matching)
 */
async function searchAgents(
  query: string,
  userId: string | null
): Promise<Array<{ id: string; name: string; status: string }>> {
  if (!userId) return []

  try {
    const { data: agents, error } = await supabase
      .from('agents')
      .select('id, agent_name, status')
      .eq('user_id', userId)
      .ilike('agent_name', `%${query}%`)
      .limit(5)

    if (error) {
      console.error('[HelpBot] Agent search error:', error)
      return []
    }

    return agents?.map((a) => ({ id: a.id, name: a.agent_name, status: a.status })) || []
  } catch (error) {
    console.error('[HelpBot] Agent search error:', error)
    return []
  }
}

/**
 * Detect if user is asking about a specific agent
 */
function detectAgentSearchQuery(query: string): string | null {
  const lowerQuery = query.toLowerCase()

  // Don't trigger agent search for generic "all agents" queries
  if (lowerQuery.match(/^(?:find|search|show|locate|open|view|see)\s+(?:me\s+)?(?:my\s+)?(?:all\s+)?agents?\s*$/i)) {
    return null
  }

  const searchPatterns = [
    // "find my X agent" or "find my agent X"
    /(?:find|search|show|locate|open|view|see|where is)\s+(?:my\s+)?(?:agent\s+)?(?:called\s+|named\s+)?["']?([^"'?.]+?)["']?(?:\s+agent)?$/i,

    // "I cannot find my agent X" or "I do not find my agent X"
    /(?:cannot|can't|do not|don't|can not)\s+(?:find|locate|see)\s+(?:my\s+)?agent[.,]?\s+(?:it\s+)?(?:called|named|it's|its)\s+(.+?)(?:\s+with\s+|\s*$)/i,

    // "agent called X" or "agent named X"
    /agent\s+(?:called|named|with)\s+["']?([^"'?.]+?)["']?(?:\s+in\s+|\s*$)/i,

    // "called something with X"
    /called\s+something\s+(?:with|like|containing)\s+(.+?)(?:\s+in\s+|\s*$)/i,

    // "agent X" or "my X agent"
    /(?:my\s+)?(?:agent|bot)\s+["']?([^"'?.]+?)["']?$/i,

    // Quoted agent name
    /(?:agent|bot)?\s*["']([^"']+)["']/i,

    // "where is my X" (X is potential agent name)
    /(?:what|where)\s+(?:is\s+)?(?:my\s+)?([^"'?]+?)\s*(?:agent|bot)/i,
  ]

  for (const pattern of searchPatterns) {
    const match = query.match(pattern)
    if (match && match[1] && match[1].trim().length > 0) {
      let agentName = match[1].trim()

      // Clean up common stop words
      agentName = agentName.replace(/\b(my|the|an?|its?)\b/gi, '').trim()
      agentName = agentName.replace(/^all\s+/i, '').trim()

      // Remove trailing punctuation
      agentName = agentName.replace(/[.,!?]+$/, '').trim()

      if (agentName.length > 0 && !['all', 'agents', 'agent', 'every', 'any'].includes(agentName.toLowerCase())) {
        return agentName
      }
    }
  }

  return null
}

// ============================================================================
// Layer 1: FAQ Lookup
// ============================================================================

async function searchFAQ(
  question: string,
  pageContext: string
): Promise<string | null> {
  const normalized = normalizeQuestion(question)
  const keywords = normalized.split(' ').filter(w => w.length > 2) // Filter out short words

  try {
    // Search by keywords using array overlap
    const { data, error } = await supabase
      .from('help_articles')
      .select('*')
      .eq('page_context', pageContext)
      .order('id')

    if (error) throw error

    // Find best match by keyword overlap with weighted scoring
    let bestMatch: any = null
    let bestScore = 0

    for (const article of data || []) {
      const articleKeywords = article.keywords || []
      let score = 0

      // Calculate score based on keyword matches
      for (const kw of keywords) {
        for (const ak of articleKeywords) {
          // Exact match: highest score
          if (ak === kw) {
            score += 10
          }
          // Article keyword contains query keyword
          else if (ak.includes(kw)) {
            score += 5
          }
          // Query keyword contains article keyword
          else if (kw.includes(ak)) {
            score += 3
          }
        }
      }

      // Check for phrase matches (multiple consecutive words)
      const normalizedArticleKeywords = articleKeywords.join(' ')
      if (normalizedArticleKeywords.includes(normalized)) {
        score += 20 // Bonus for phrase match
      }

      if (score > bestScore) {
        bestScore = score
        bestMatch = article
      }
    }

    // Require minimum score threshold (at least one strong match)
    if (bestScore >= 8) {
      console.log(`[HelpBot] FAQ hit: ${bestMatch.topic} (score: ${bestScore})`)
      return bestMatch.body
    }

    return null
  } catch (error) {
    console.error('[HelpBot] FAQ search error:', error)
    return null
  }
}

// ============================================================================
// Layer 2: Cache Lookup (Hybrid: Exact Hash + Semantic Search)
// ============================================================================

async function searchCache(
  question: string,
  questionHash: string,
  pageContext?: string
): Promise<{ answer: string; id: string; matchType: 'exact' | 'semantic' } | null> {
  try {
    // Step 1: Try exact hash match first (fastest, most reliable)
    const { data: exactMatch, error: exactError } = await supabase
      .from('support_cache')
      .select('*')
      .eq('question_hash', questionHash)
      .single()

    if (exactMatch) {
      // Update hit count and last_seen
      await supabase
        .from('support_cache')
        .update({
          hit_count: exactMatch.hit_count + 1,
          last_seen: new Date().toISOString(),
        })
        .eq('id', exactMatch.id)

      console.log(`[HelpBot] Exact cache hit: ${exactMatch.question.substring(0, 50)}... (${exactMatch.hit_count} hits)`)
      return { answer: exactMatch.answer, id: exactMatch.id, matchType: 'exact' }
    }

    // Step 2: Check if semantic search is enabled
    const semanticEnabled = await SystemConfigService.getBoolean(
      supabase,
      'helpbot_semantic_search_enabled',
      true
    )

    if (!semanticEnabled) {
      return null // Semantic search disabled, no match found
    }

    // Step 3: Try semantic search
    const embeddingService = new EmbeddingService(process.env.OPENAI_API_KEY!, supabase)

    // Generate embedding for the question
    const { embedding, cost: embeddingCost } = await embeddingService.generateEmbedding(question)

    // Get similarity threshold from config
    const similarityThreshold = await SystemConfigService.getNumber(
      supabase,
      'helpbot_semantic_threshold',
      0.85
    )

    // Search using the database function
    const { data: semanticMatches, error: semanticError } = await supabase
      .rpc('search_support_cache_semantic', {
        query_embedding: JSON.stringify(embedding),
        similarity_threshold: similarityThreshold,
        result_limit: 1,
        p_page_context: pageContext || null,
      })

    if (semanticError) {
      console.error('[HelpBot] Semantic search error:', semanticError)
      return null
    }

    if (semanticMatches && semanticMatches.length > 0) {
      const match = semanticMatches[0]

      // Update hit count and last_seen
      await supabase
        .from('support_cache')
        .update({
          hit_count: match.hit_count + 1,
          last_seen: new Date().toISOString(),
        })
        .eq('id', match.id)

      console.log(`[HelpBot] Semantic cache hit: ${match.question.substring(0, 50)}... (similarity: ${match.similarity.toFixed(3)}, ${match.hit_count} hits)`)
      console.log(`[HelpBot] Embedding cost: $${embeddingCost.toFixed(6)}`)

      return { answer: match.answer, id: match.id, matchType: 'semantic' }
    }

    // No match found
    return null
  } catch (error) {
    console.error('[HelpBot] Cache search error:', error)
    return null
  }
}

// ============================================================================
// Input Help Mode: URL Extraction and Field Assistance
// ============================================================================

async function handleInputHelp(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  context: any
): Promise<string> {
  const lastMessage = messages[messages.length - 1]
  const userInput = lastMessage.content

  console.log('[InputHelp] Processing input:', {
    fieldName: context.fieldName,
    plugin: context.plugin,
    expectedType: context.expectedType,
    userInput: userInput.substring(0, 100),
  })

  // Check if user provided a URL
  if (UrlParserService.isValidUrl(userInput)) {
    // Try to extract ID from URL
    const extraction = UrlParserService.extractForField(
      userInput,
      context.plugin,
      context.expectedType,
      context.fieldName  // Pass field name for special handling
    )

    console.log('[InputHelp] Extraction result:', extraction)

    if (extraction.success && extraction.value) {
      // Return JSON action to fill the field
      return JSON.stringify({
        action: 'fill_agent_input',
        agentId: context.agentId,
        fieldName: context.fieldName,
        value: extraction.value,
      })
    } else if (extraction.error === 'NEEDS_AI_GUIDANCE') {
      // Special case: Field needs conversational guidance (e.g., range field)
      // Let AI explain how to find the value
      return await callGroqForInputHelp(messages, context)
    } else {
      // Extraction failed - provide helpful error
      return extraction.error || 'Could not extract the value from this URL. Please check the format.'
    }
  }

  // User didn't provide a URL - use AI to guide them
  return await callGroqForInputHelp(messages, context)
}

async function callGroqForInputHelp(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  context: any
): Promise<string> {
  // Load input assistant prompt template
  const templatePath = path.join(process.cwd(), 'app/api/prompt-templates/Input-Assistant-Prompt-v1.txt')
  let systemPrompt = ''

  try {
    systemPrompt = fs.readFileSync(templatePath, 'utf-8')

    // Replace placeholders
    systemPrompt = systemPrompt
      .replace(/\{\{agentId\}\}/g, context.agentId || 'unknown')
      .replace(/\{\{agentName\}\}/g, context.agentName || 'your agent')
      .replace(/\{\{fieldName\}\}/g, context.fieldName || 'this field')
      .replace(/\{\{expectedType\}\}/g, context.expectedType || 'string')
      .replace(/\{\{plugin\}\}/g, context.plugin || 'the service')
  } catch (error) {
    console.error('[InputHelp] Failed to load prompt template:', error)
    // Fallback prompt
    systemPrompt = `You are helping a user fill the field "${context.fieldName}" for their automation agent. Ask them to provide the normal URL/link, not technical IDs. When they provide a URL, respond with: {"action": "fill_agent_input", "agentId": "${context.agentId}", "fieldName": "${context.fieldName}", "value": "<extracted_value>"}`
  }

  const aiMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...messages.slice(-5).map((msg: any) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    })),
  ]

  const callContext = {
    userId: 'system',
    user_id: 'system',
    feature: 'input_help_bot',
    component: 'input-assistant',
    category: 'agent_input',
    activity_type: 'field_assistance',
    activity_name: 'Input field help',
    workflow_step: 'groq_guidance',
  }

  const groqProvider = new GroqProvider(process.env.GROQ_API_KEY!, aiAnalytics)

  // Fetch dynamic config from database
  const model = await SystemConfigService.getString(supabase, 'helpbot_input_model', 'llama-3.1-8b-instant')
  const temperature = await SystemConfigService.getNumber(supabase, 'helpbot_input_temperature', 0.3)
  const maxTokens = await SystemConfigService.getNumber(supabase, 'helpbot_input_max_tokens', 400)

  const response = await groqProvider.chatCompletion(
    {
      model,
      messages: aiMessages,
      temperature,
      max_tokens: maxTokens,
    },
    callContext
  )

  return response.choices[0]?.message?.content || 'I can help you fill this field. Just paste the link!'
}

// ============================================================================
// Layer 3: Groq Fallback
// ============================================================================

async function callGroq(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  pageContext: any
): Promise<string> {
  const systemPrompt = `You are a helpful support assistant for NeuronForge, an AI agent platform.

Current page: ${pageContext.title || pageContext.path}
Description: ${pageContext.description || ''}

Your role:
- Provide clear, concise answers about the current page and NeuronForge features
- Be friendly and conversational
- Use **bold** for emphasis on important terms
- Keep responses under 150 words
- When mentioning navigation, use this format: [Link Text](/path)

FORMATTING REQUIREMENTS:
- Use double line breaks between sections for better readability
- Break down complex information into clear, digestible paragraphs
- Use bullet points with proper spacing (add line break before and after lists)
- Use bold numbers for step-by-step instructions (e.g., **1.**, **2.**)
- Add line breaks before and after important sections
- Keep paragraphs short (2-3 sentences max)

Available pages:
- Dashboard (/v2/dashboard): Overview of agents, credits, system alerts
- Agent List (/v2/agent-list): View and manage all agents
- Analytics (/v2/analytics): Track performance and costs
- Billing (/v2/billing): Manage credits and subscriptions
- Settings (/v2/settings): Configure API keys and integrations
- Create Agent (/v2/agents/new): Build new AI agents

Answer the user's question based on the current page context.`

  const aiMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...messages.slice(-5).map((msg: any) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    })),
  ]

  const callContext = {
    userId: 'system',
    user_id: 'system',
    feature: 'help_bot_v2',
    component: 'support-bot-groq',
    category: 'support',
    activity_type: 'help_interaction',
    activity_name: 'Self-learning support bot',
    workflow_step: 'groq_fallback',
  }

  const groqProvider = new GroqProvider(process.env.GROQ_API_KEY!, aiAnalytics)

  // Fetch dynamic config from database
  const model = await SystemConfigService.getString(supabase, 'helpbot_general_model', 'llama-3.1-8b-instant')
  const temperature = await SystemConfigService.getNumber(supabase, 'helpbot_general_temperature', 0.2)
  const maxTokens = await SystemConfigService.getNumber(supabase, 'helpbot_general_max_tokens', 300)

  const response = await groqProvider.chatCompletion(
    {
      model,
      messages: aiMessages,
      temperature,
      max_tokens: maxTokens,
    },
    callContext
  )

  return response.choices[0]?.message?.content || 'I apologize, but I could not generate a response.'
}

// ============================================================================
// Store answer in cache
// ============================================================================

async function storeInCache(
  question: string,
  questionHash: string,
  answer: string,
  source: string,
  pageContext: string
): Promise<void> {
  try {
    // Generate embedding for the question
    let embedding: number[] | null = null
    let embeddingCost = 0

    const semanticEnabled = await SystemConfigService.getBoolean(
      supabase,
      'helpbot_semantic_search_enabled',
      true
    )

    if (semanticEnabled) {
      try {
        const embeddingService = new EmbeddingService(process.env.OPENAI_API_KEY!, supabase)
        const result = await embeddingService.generateEmbedding(question)
        embedding = result.embedding
        embeddingCost = result.cost
        console.log(`[HelpBot] Generated embedding for cache ($${embeddingCost.toFixed(6)})`)
      } catch (error) {
        console.error('[HelpBot] Failed to generate embedding:', error)
        // Continue without embedding - cache will still work with exact matching
      }
    }

    // Store in cache with embedding
    await supabase.from('support_cache').insert({
      question_hash: questionHash,
      question,
      answer,
      source,
      page_context: pageContext,
      hit_count: 1,
      embedding: embedding,
    })

    console.log(`[HelpBot] Stored in cache: ${question.substring(0, 50)}...`)
  } catch (error) {
    console.error('[HelpBot] Cache storage error:', error)
  }
}

// ============================================================================
// Update analytics
// ============================================================================

async function updateAnalytics(source: string, responseTimeMs: number): Promise<void> {
  try {
    // Estimate cost: Groq is ~$0.0001 per call (very rough estimate)
    const costUsd = source === 'Groq' ? 0.0001 : 0

    await supabase.rpc('update_support_analytics', {
      p_source: source,
      p_response_time_ms: responseTimeMs,
      p_cost_usd: costUsd,
    })
  } catch (error) {
    console.error('[HelpBot] Analytics update error:', error)
  }
}

// ============================================================================
// Main API Handler
// ============================================================================

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    const { messages, pageContext, context } = await request.json()

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Invalid request: messages required' }, { status: 400 })
    }

    const lastMessage = messages[messages.length - 1]
    if (lastMessage.role !== 'user') {
      return NextResponse.json({ error: 'Last message must be from user' }, { status: 400 })
    }

    // ========================================================================
    // Check if this is INPUT HELP mode (field-specific assistance)
    // ========================================================================
    if (context && context.mode === 'input_help') {
      console.log('[HelpBot] Input help mode activated for field:', context.fieldName)
      const response = await handleInputHelp(messages, context)
      await updateAnalytics('InputHelp', Date.now() - startTime)
      return NextResponse.json({ response, source: 'InputHelp' })
    }

    const userId = request.headers.get('x-user-id') || null
    const question = lastMessage.content
    const questionHash = hashQuestion(question)
    const pagePath = pageContext?.path || '/v2/dashboard'

    // ========================================================================
    // Step 1: Check if user is searching for a specific agent
    // ========================================================================
    const agentSearchQuery = detectAgentSearchQuery(question)
    if (agentSearchQuery && userId) {
      const foundAgents = await searchAgents(agentSearchQuery, userId)

      if (foundAgents.length > 0) {
        const response =
          foundAgents.length === 1
            ? `I found your agent **${foundAgents[0].name}**! [View it here](/v2/agents/${foundAgents[0].id})\n\nStatus: **${foundAgents[0].status}**`
            : `I found ${foundAgents.length} agents matching "${agentSearchQuery}":\n\n` +
              foundAgents.map((a) => `- [${a.name}](/v2/agents/${a.id}) (${a.status})`).join('\n')

        await updateAnalytics('AgentSearch', Date.now() - startTime)
        return NextResponse.json({ response, source: 'AgentSearch' })
      }
    }

    // ========================================================================
    // Step 2: Try FAQ lookup (free, instant)
    // ========================================================================
    const faqAnswer = await searchFAQ(question, pagePath)
    if (faqAnswer) {
      await updateAnalytics('FAQ', Date.now() - startTime)
      return NextResponse.json({ response: faqAnswer, source: 'FAQ' })
    }

    // ========================================================================
    // Step 3: Try cache lookup (hybrid: exact hash + semantic search)
    // ========================================================================
    const cachedResult = await searchCache(question, questionHash, pagePath)
    if (cachedResult) {
      // Track whether it was exact or semantic match in analytics
      const isSemanticHit = cachedResult.matchType === 'semantic'
      const isExactHit = cachedResult.matchType === 'exact'

      await updateAnalytics('Cache', Date.now() - startTime)
      return NextResponse.json({
        response: cachedResult.answer,
        source: 'Cache',
        cacheId: cachedResult.id,
        matchType: cachedResult.matchType, // 'exact' or 'semantic'
      })
    }

    // ========================================================================
    // Step 4: Groq fallback (cheap, but costs money)
    // ========================================================================
    console.log(`[HelpBot] FAQ and Cache miss. Calling Groq for: "${question.substring(0, 50)}..."`)

    const groqAnswer = await callGroq(messages, pageContext)

    // Store in cache for future reuse
    await storeInCache(question, questionHash, groqAnswer, 'Groq', pagePath)

    await updateAnalytics('Groq', Date.now() - startTime)

    return NextResponse.json({ response: groqAnswer, source: 'Groq' })
  } catch (error: any) {
    console.error('[HelpBot] Error:', error)
    return NextResponse.json(
      { error: 'Failed to process your question. Please try again.' },
      { status: 500 }
    )
  }
}
