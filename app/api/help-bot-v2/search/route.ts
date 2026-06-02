// app/api/help-bot-v2/search/route.ts
// Article search endpoint for ModernHelpDialog search mode

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Normalize question for consistent matching
 */
function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')     // Normalize whitespace
}

/**
 * Normalize page path to match FAQ storage patterns
 * Converts actual URLs like /v2/sandbox/123 to patterns like /v2/sandbox/[agentId]
 */
function normalizePageContext(path: string): string {
  // UUID pattern (8-4-4-4-12 format)
  let normalized = path

  // /v2/agents/{uuid} -> /v2/agents/[id]
  if (/^\/v2\/agents\/[0-9a-f-]{36}$/i.test(normalized)) {
    normalized = '/v2/agents/[id]'
  }
  // /v2/agents/{uuid}/run -> /v2/agents/[id]/run
  else if (/^\/v2\/agents\/[0-9a-f-]{36}\/run$/i.test(normalized)) {
    normalized = '/v2/agents/[id]/run'
  }
  // /v2/sandbox/{uuid} -> /v2/sandbox/[agentId]
  else if (/^\/v2\/sandbox\/[0-9a-f-]{36}$/i.test(normalized)) {
    normalized = '/v2/sandbox/[agentId]'
  }

  return normalized
}

/**
 * GET handler for article search
 * Query params: q (query string), context (page path)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q') || ''
    const context = searchParams.get('context') || '/v2/dashboard'

    // Return empty results for very short queries
    if (query.trim().length < 2) {
      return NextResponse.json({ results: [] })
    }

    console.log(`[HelpBot Search] Query: "${query}", Context: ${context}`)

    const normalized = normalizeQuestion(query)
    const keywords = normalized.split(' ').filter(w => w.length > 2)
    const normalizedContext = normalizePageContext(context)

    console.log(`[HelpBot Search] Normalized: "${normalized}"`)
    console.log(`[HelpBot Search] Keywords: [${keywords.join(', ')}] (${keywords.length} keywords)`)
    console.log(`[HelpBot Search] Normalized context: ${normalizedContext}`)

    // Search ALL help articles (not just current page)
    const { data, error } = await supabase
      .from('help_articles')
      .select('*')
      .order('id')

    if (error) {
      console.error('[HelpBot Search] Database error:', error)
      return NextResponse.json({ results: [] })
    }

    console.log(`[HelpBot Search] Found ${data?.length || 0} total articles in database`)

    // Score and rank articles by keyword overlap
    const scoredArticles = (data || []).map(article => {
      const articleKeywords = article.keywords || []
      let score = 0

      // Calculate score based on keyword matches
      for (const kw of keywords) {
        for (const articleKw of articleKeywords) {
          if (articleKw.toLowerCase().includes(kw) || kw.includes(articleKw.toLowerCase())) {
            score += 1
          }
        }
      }

      // Boost score if topic matches
      if (article.topic.toLowerCase().includes(query.toLowerCase())) {
        score += 5
      }

      // Boost score for articles from the current page context
      if (article.page_context === normalizedContext) {
        score += 2
      }

      return {
        id: article.id.toString(),
        title: article.topic,
        snippet: article.body.substring(0, 200) + (article.body.length > 200 ? '...' : ''),
        url: article.url || '#',
        relevanceScore: score,
        category: article.page_context === normalizedContext ? 'Documentation' : 'General',
        pageContext: article.page_context, // Include for debugging
      }
    })
    .filter(article => article.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 10) // Return top 10 results

    console.log(`[HelpBot Search] Scored articles:`, scoredArticles.map(a => `${a.title} (score: ${a.relevanceScore}, context: ${a.pageContext})`))
    console.log(`[HelpBot Search] Returning ${scoredArticles.length} scored results`)

    return NextResponse.json({ results: scoredArticles })
  } catch (error) {
    console.error('[HelpBot Search] Error:', error)
    return NextResponse.json({ results: [] })
  }
}
