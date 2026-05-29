import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'
import { createLogger } from '@/lib/logger'

const logger = createLogger({ module: 'HelpArticleAPI' })

/**
 * Get full article content by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })

  try {
    const articleId = params.id

    if (!articleId) {
      return NextResponse.json(
        { error: 'Article ID is required' },
        { status: 400 }
      )
    }

    requestLogger.debug({ articleId }, 'Fetching article')

    const { data: article, error } = await supabaseServer
      .from('help_articles')
      .select('id, topic, body, url, keywords, page_context')
      .eq('id', articleId)
      .single()

    if (error || !article) {
      requestLogger.warn({ err: error, articleId }, 'Article not found')
      return NextResponse.json(
        { error: 'Article not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      id: article.id,
      title: article.topic,
      body: article.body,
      url: article.url,
      keywords: article.keywords,
      category: article.page_context || 'Documentation'
    })
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch article')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
