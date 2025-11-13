// app/api/help-bot-v2/feedback/route.ts
// Handle user feedback (thumbs up/down) for cached support responses

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const { cacheId, feedbackType } = await request.json()

    if (!cacheId || !feedbackType) {
      return NextResponse.json(
        { error: 'Missing required fields: cacheId, feedbackType' },
        { status: 400 }
      )
    }

    if (feedbackType !== 'up' && feedbackType !== 'down') {
      return NextResponse.json(
        { error: 'Invalid feedbackType. Must be "up" or "down"' },
        { status: 400 }
      )
    }

    // Get current feedback counts
    const { data: currentData, error: fetchError } = await supabase
      .from('support_cache')
      .select('thumbs_up, thumbs_down')
      .eq('id', cacheId)
      .single()

    if (fetchError || !currentData) {
      console.error('[Feedback] Cache entry not found:', cacheId)
      return NextResponse.json(
        { error: 'Cache entry not found' },
        { status: 404 }
      )
    }

    // Increment the appropriate counter
    const updateField = feedbackType === 'up' ? 'thumbs_up' : 'thumbs_down'
    const newValue = (currentData[updateField] || 0) + 1

    const { error: updateError } = await supabase
      .from('support_cache')
      .update({ [updateField]: newValue })
      .eq('id', cacheId)

    if (updateError) {
      console.error('[Feedback] Update error:', updateError)
      return NextResponse.json(
        { error: 'Failed to update feedback' },
        { status: 500 }
      )
    }

    console.log(`[Feedback] ${feedbackType} recorded for cache entry ${cacheId}`)

    return NextResponse.json({
      success: true,
      feedback: feedbackType,
      newCount: newValue,
    })
  } catch (error: any) {
    console.error('[Feedback] Error:', error)
    return NextResponse.json(
      { error: 'Failed to process feedback' },
      { status: 500 }
    )
  }
}
