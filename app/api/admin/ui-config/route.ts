import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Create Supabase client with service role for admin operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

// GET - Fetch current UI version and custom tokens
export async function GET() {
  try {
    // Fetch UI version
    const { data: versionData, error: versionError } = await supabase
      .from('system_settings_config')
      .select('value')
      .eq('key', 'ui_version')
      .single()

    // Fetch custom tokens
    const { data: tokensData, error: tokensError } = await supabase
      .from('system_settings_config')
      .select('value')
      .eq('key', 'v2_custom_tokens')
      .single()

    return NextResponse.json({
      success: true,
      data: {
        uiVersion: versionData?.value || 'v1',
        customTokens: tokensData?.value || {}
      }
    })
  } catch (error) {
    console.error('Error fetching UI config:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch UI configuration' },
      { status: 500 }
    )
  }
}

// POST - Update UI version or custom tokens
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, data } = body

    if (action === 'update_version') {
      const { version } = data

      console.log('[UI Config API] Updating version to:', version)

      const { data: result, error } = await supabase
        .from('system_settings_config')
        .upsert(
          {
            key: 'ui_version',
            value: version,
            category: 'ui',
            description: 'Active UI version (v1 or v2)',
          },
          {
            onConflict: 'key'
          }
        )
        .select()

      if (error) {
        console.error('[UI Config API] Error updating UI version:', error)
        console.error('[UI Config API] Error details:', JSON.stringify(error, null, 2))
        return NextResponse.json(
          { success: false, error: error.message, details: error },
          { status: 500 }
        )
      }

      console.log('[UI Config API] Successfully updated, result:', result)

      return NextResponse.json({
        success: true,
        message: `Successfully switched to ${version.toUpperCase()}`
      })
    }

    if (action === 'save_tokens') {
      const { tokens } = data

      const { error } = await supabase
        .from('system_settings_config')
        .upsert(
          {
            key: 'v2_custom_tokens',
            value: tokens,
            category: 'ui',
            description: 'Custom design tokens for V2 theme',
          },
          {
            onConflict: 'key'
          }
        )

      if (error) {
        console.error('Error saving custom tokens:', error)
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        message: 'Custom tokens saved successfully'
      })
    }

    if (action === 'reset_tokens') {
      const { error } = await supabase
        .from('system_settings_config')
        .delete()
        .eq('key', 'v2_custom_tokens')

      if (error) {
        console.error('Error resetting tokens:', error)
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        message: 'Tokens reset to defaults successfully'
      })
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Error in UI config API:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
