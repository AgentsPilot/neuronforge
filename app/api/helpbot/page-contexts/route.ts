import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const dynamic = 'force-dynamic'

/**
 * GET /api/helpbot/page-contexts
 * Fetch all page contexts or a specific one by route
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const route = searchParams.get('route')

    if (route) {
      // Get specific page context
      const { data, error } = await supabase
        .from('helpbot_page_contexts')
        .select('*')
        .eq('page_route', route)
        .single()

      if (error && error.code !== 'PGRST116') { // PGRST116 = not found
        throw error
      }

      return NextResponse.json({ success: true, context: data || null })
    } else {
      // Get all page contexts
      const { data, error } = await supabase
        .from('helpbot_page_contexts')
        .select('*')
        .order('page_route')

      if (error) throw error

      return NextResponse.json({ success: true, contexts: data || [] })
    }
  } catch (error: any) {
    console.error('[Page Contexts API] GET Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

/**
 * POST /api/helpbot/page-contexts
 * Create a new page context
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { page_route, title, description, quick_questions } = body

    if (!page_route || !title) {
      return NextResponse.json(
        { success: false, error: 'page_route and title are required' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('helpbot_page_contexts')
      .insert({
        page_route,
        title,
        description: description || null,
        quick_questions: quick_questions || [],
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({
      success: true,
      message: 'Page context created successfully',
      context: data,
    })
  } catch (error: any) {
    console.error('[Page Contexts API] POST Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

/**
 * PUT /api/helpbot/page-contexts
 * Update an existing page context
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { page_route, title, description, quick_questions } = body

    if (!page_route) {
      return NextResponse.json(
        { success: false, error: 'page_route is required' },
        { status: 400 }
      )
    }

    const updates: any = {}
    if (title !== undefined) updates.title = title
    if (description !== undefined) updates.description = description
    if (quick_questions !== undefined) updates.quick_questions = quick_questions

    const { data, error } = await supabase
      .from('helpbot_page_contexts')
      .update(updates)
      .eq('page_route', page_route)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({
      success: true,
      message: 'Page context updated successfully',
      context: data,
    })
  } catch (error: any) {
    console.error('[Page Contexts API] PUT Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

/**
 * DELETE /api/helpbot/page-contexts
 * Delete a page context
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const route = searchParams.get('route')

    if (!route) {
      return NextResponse.json(
        { success: false, error: 'route parameter is required' },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from('helpbot_page_contexts')
      .delete()
      .eq('page_route', route)

    if (error) throw error

    return NextResponse.json({
      success: true,
      message: 'Page context deleted successfully',
    })
  } catch (error: any) {
    console.error('[Page Contexts API] DELETE Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
