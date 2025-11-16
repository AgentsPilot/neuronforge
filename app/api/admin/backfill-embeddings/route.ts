import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { EmbeddingService } from '@/lib/services/EmbeddingService'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/backfill-embeddings
 * Backfill embeddings for existing support_cache and help_articles
 */
export async function POST(request: NextRequest) {
  try {
    const { target, limit } = await request.json()

    if (!['cache', 'faq', 'both'].includes(target)) {
      return NextResponse.json(
        { success: false, error: 'Invalid target. Must be "cache", "faq", or "both"' },
        { status: 400 }
      )
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'OPENAI_API_KEY not configured' },
        { status: 500 }
      )
    }

    const embeddingService = new EmbeddingService(process.env.OPENAI_API_KEY, supabase)
    const results: any = {}

    // Backfill cache embeddings
    if (target === 'cache' || target === 'both') {
      const cacheLimit = limit || 100
      console.log(`[Backfill] Starting cache backfill (limit: ${cacheLimit})...`)

      const cacheResult = await embeddingService.backfillCacheEmbeddings(cacheLimit)
      results.cache = {
        processed: cacheResult.processed,
        totalCost: cacheResult.totalCost,
      }

      console.log(`[Backfill] Cache complete: ${cacheResult.processed} entries, $${cacheResult.totalCost.toFixed(6)}`)
    }

    // Backfill FAQ embeddings
    if (target === 'faq' || target === 'both') {
      console.log('[Backfill] Starting FAQ backfill...')

      const faqResult = await embeddingService.backfillFAQEmbeddings()
      results.faq = {
        processed: faqResult.processed,
        totalCost: faqResult.totalCost,
      }

      console.log(`[Backfill] FAQ complete: ${faqResult.processed} articles, $${faqResult.totalCost.toFixed(6)}`)
    }

    const totalProcessed = (results.cache?.processed || 0) + (results.faq?.processed || 0)
    const totalCost = (results.cache?.totalCost || 0) + (results.faq?.totalCost || 0)

    return NextResponse.json({
      success: true,
      message: `Backfill completed successfully`,
      details: {
        ...results,
        total: {
          processed: totalProcessed,
          cost: totalCost,
        },
      },
    })
  } catch (error: any) {
    console.error('[Backfill] Error:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

/**
 * GET /api/admin/backfill-embeddings/status
 * Get status of embeddings backfill
 */
export async function GET() {
  try {
    // Count cache entries without embeddings
    const { count: cacheWithoutEmbeddings, error: cacheError } = await supabase
      .from('support_cache')
      .select('*', { count: 'exact', head: true })
      .is('embedding', null)

    if (cacheError) throw cacheError

    // Count FAQ articles without embeddings
    const { count: faqWithoutEmbeddings, error: faqError } = await supabase
      .from('help_articles')
      .select('*', { count: 'exact', head: true })
      .is('embedding', null)

    if (faqError) throw faqError

    // Count total cache entries
    const { count: totalCache, error: totalCacheError } = await supabase
      .from('support_cache')
      .select('*', { count: 'exact', head: true })

    if (totalCacheError) throw totalCacheError

    // Count total FAQ articles
    const { count: totalFaq, error: totalFaqError } = await supabase
      .from('help_articles')
      .select('*', { count: 'exact', head: true })

    if (totalFaqError) throw totalFaqError

    const cachePercentComplete = totalCache
      ? Math.round(((totalCache - (cacheWithoutEmbeddings || 0)) / totalCache) * 100)
      : 100

    const faqPercentComplete = totalFaq
      ? Math.round(((totalFaq - (faqWithoutEmbeddings || 0)) / totalFaq) * 100)
      : 100

    return NextResponse.json({
      success: true,
      status: {
        cache: {
          total: totalCache || 0,
          withEmbeddings: (totalCache || 0) - (cacheWithoutEmbeddings || 0),
          withoutEmbeddings: cacheWithoutEmbeddings || 0,
          percentComplete: cachePercentComplete,
        },
        faq: {
          total: totalFaq || 0,
          withEmbeddings: (totalFaq || 0) - (faqWithoutEmbeddings || 0),
          withoutEmbeddings: faqWithoutEmbeddings || 0,
          percentComplete: faqPercentComplete,
        },
      },
    })
  } catch (error: any) {
    console.error('[Backfill Status] Error:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
