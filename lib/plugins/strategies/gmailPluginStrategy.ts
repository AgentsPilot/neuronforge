import type { PluginStrategy, PluginStrategyArgs } from '../types'
import { supabase } from '@/lib/supabaseClient'

export const gmailPluginStrategy: PluginStrategy = {
  connect: async ({ supabase, popup }: PluginStrategyArgs) => {
    if (!popup) throw new Error('Popup was blocked by the browser.')

    try {
      popup.document.write(`
        <html><head><title>Connecting...</title></head>
        <body><p style="font-family:sans-serif;padding:20px;">Connecting to Google Mail...</p></body>
        </html>
      `)
    } catch {}

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      popup.close()
      throw new Error('User not authenticated')
    }

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!
    const redirectUri = `${window.location.origin}/oauth/callback/google-mail` // ✅ CORRECT
    const scope = encodeURIComponent('https://mail.google.com https://www.googleapis.com/auth/userinfo.email')

    console.log('Redirect URI used:', redirectUri)

    const state = encodeURIComponent(
      JSON.stringify({
        user_id: user.id,
        plugin_key: 'google-mail',
      })
    )

    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth` +
      `?response_type=code` +
      `&client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${scope}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${state}`

    console.log('🔗 OAuth URL:', oauthUrl)
    popup.location.href = oauthUrl
  },

  disconnect: async ({ supabase, onUpdate }: PluginStrategyArgs) => {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) throw new Error('User not authenticated')

    const pluginKey = 'google-mail'

    const res = await fetch(`/api/plugin-connections?plugin_key=${pluginKey}&user_id=${user.id}`, {
      method: 'DELETE',
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to disconnect Gmail: ${text}`)
    }

    onUpdate({
      connectedPlugins: {
        [pluginKey]: { connected: false },
      },
    })
  },

  handleOAuthCallback: async ({ code, state }) => {
    const { user_id } = JSON.parse(state)

    const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/oauth/callback/google-mail` // ✅ Must match Google Console
    console.log('📣 Token exchange redirect URI:', redirectUri)

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
        client_secret: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenRes.ok) {
      const errText = await tokenRes.text()
      throw new Error(`Token exchange failed: ${errText}`)
    }

    const tokenData = await tokenRes.json()

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })

    if (!userRes.ok) {
      const errText = await userRes.text()
      throw new Error(`Failed to fetch Gmail profile: ${errText}`)
    }

    const profile = await userRes.json()

    return {
      user_id,
      plugin_key: 'google-mail',
      username: profile.email,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token ?? null,
      expires_at: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : null,
      credentials: tokenData,
    }
  },
}