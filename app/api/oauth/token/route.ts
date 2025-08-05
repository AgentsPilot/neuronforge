// app/api/oauth/token/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { gmailStrategy } from '@/lib/plugins/strategies/gmailPluginStrategy'
import { createServerClient } from '@supabase/ssr'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const plugin = searchParams.get('plugin')

    console.log('🔄 API OAuth token exchange:', { hasCode: !!code, hasState: !!state, plugin })

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

    // Handle Gmail plugin specifically
    if (plugin === 'google-mail') {
      // Create server-side Supabase client (following your existing pattern)
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
      
      const result = await gmailStrategy.handleOAuthCallback({
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
    console.error('❌ API OAuth token exchange error:', error)
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Token exchange failed',
        success: false 
      },
      { status: 500 }
    )
  }
}