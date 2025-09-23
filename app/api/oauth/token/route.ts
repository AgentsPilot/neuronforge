// app/api/oauth/token/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { gmailStrategy } from '@/lib/plugins/strategies/gmailPluginStrategy'
import { slackStrategy } from '@/lib/plugins/strategies/slackPluginStrategy'
import { googleDriveStrategy } from '@/lib/plugins/strategies/googleDrivePluginStrategy'
import { createServerClient } from '@supabase/ssr'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const plugin = searchParams.get('plugin')

    console.log('OAuth token exchange:', { hasCode: !!code, hasState: !!state, plugin })

    if (!code || !state) {
      return NextResponse.json(
        { error: 'Missing code or state parameter', success: false },
        { status: 400 }
      )
    }

    if (!plugin) {
      return NextResponse.json(
        { error: 'Missing plugin parameter', success: false },
        { status: 400 }
      )
    }

    // Create server-side Supabase client
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          get: () => undefined,
          set: () => {},
          remove: () => {},
        },
      }
    )

    // Handle Gmail plugin
    if (plugin === 'google-mail') {
      const result = await gmailStrategy.handleOAuthCallback({
        code,
        state,
        supabase
      })

      return NextResponse.json({ success: true, data: result })
    }

    // Handle Google Drive plugin
    if (plugin === 'google-drive') {
      const result = await googleDriveStrategy.handleOAuthCallback({
        code,
        state,
        supabase
      })


      return NextResponse.json({ success: true, data: result })
    }

    // Handle Slack plugin
    if (plugin === 'slack') {
      const result = await slackStrategy.handleOAuthCallback({
        code,
        state,
        supabase
      })


      return NextResponse.json({ success: true, data: result })
    }

    // Handle other plugins here if needed
    return NextResponse.json(
      { error: `Plugin ${plugin} not supported`, success: false },
      { status: 400 }
    )

  } catch (error) {
    console.error('OAuth token exchange error:', error)
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Token exchange failed',
        success: false 
      },
      { status: 500 }
    )
  }
}