// /app/api/oauth/token/route.ts

import { NextResponse } from 'next/server'
import { gmailPluginStrategy } from '@/lib/plugins/strategies/gmailPluginStrategy'
import { savePluginConnection } from '@/lib/plugins/savePluginConnection' // ✅ Import internal util

const pluginMap: Record<string, any> = {
  'google-mail': gmailPluginStrategy,
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  console.log('🔁 OAuth callback hit')
  console.log('code:', code)
  console.log('state:', state)

  if (!code || !state) {
    return new NextResponse('Missing code or state', { status: 400 })
  }

  try {
    const parsedState = JSON.parse(decodeURIComponent(state))
    const pluginKey = parsedState.plugin_key
    const strategy = pluginMap[pluginKey]

    if (!strategy || !strategy.handleOAuthCallback) {
      return new NextResponse(`No handler for plugin: ${pluginKey}`, { status: 400 })
    }

    const connection = await strategy.handleOAuthCallback({ code, state })

    console.log('📦 Plugin connection object:', connection)

    // ✅ Save directly using backend utility
    const result = await savePluginConnection(connection)
    console.log('📨 Save result:', result)

    // ✅ Redirect to popup-close handler
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/oauth/callback/${pluginKey}`)
  } catch (err: any) {
    console.error('❌ OAuth token handler failed:', err)
    return new NextResponse(`OAuth failed: ${err.message}`, { status: 500 })
  }
}