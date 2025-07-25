// lib/plugins/strategies/gmail.ts

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
    const redirectUri = `${window.location.origin}/oauth/callback/google-mail`
    const scope = encodeURIComponent('https://mail.google.com https://www.googleapis.com/auth/userinfo.email')

    const state = encodeURIComponent(JSON.stringify({ user_id: user.id, plugin_key: 'google-mail' }))
    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth` +
      `?response_type=code&client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${scope}&access_type=offline&prompt=consent&state=${state}`

    popup.location.href = oauthUrl
  },

  disconnect: async ({ supabase, onUpdate }: PluginStrategyArgs) => {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) throw new Error('User not authenticated')

    const { error: updateError } = await supabase
      .from('plugin_connections')
      .update({ disconnected_at: new Date().toISOString() })
      .eq('plugin_key', 'google-mail')
      .eq('user_id', user.id)

    if (updateError) throw new Error(`Failed to disconnect Gmail: ${updateError.message}`)

    onUpdate?.({
      connectedPlugins: { 'google-mail': { connected: false } },
    })
  },

  handleOAuthCallback: async ({ code, state }) => {
    const { user_id } = JSON.parse(state)

    const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/oauth/callback/google-mail`

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

  refreshToken: async (connection) => {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
        client_secret: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_SECRET!,
        refresh_token: connection.refresh_token,
        grant_type: 'refresh_token',
      }),
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Gmail token refresh failed: ${errorText}`)
    }

    const tokenData = await res.json()

    return {
      access_token: tokenData.access_token,
      expires_at: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : null,
      credentials: tokenData,
    }
  },

  run: async ({ connection, input_variables = {} }) => {
    const accessToken = connection.access_token
    const count = parseInt(input_variables.num_emails || '10') || 10

    const messageListRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${count}&q=is:inbox`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!messageListRes.ok) {
      const errorText = await messageListRes.text()
      throw new Error(`Failed to fetch Gmail message list: ${errorText}`)
    }

    const { messages } = await messageListRes.json()
    const emailContents: string[] = []

    for (const msg of messages || []) {
      const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (msgRes.ok) {
        const msgJson = await msgRes.json()
        const parts = msgJson.payload?.parts || []
        const plainTextPart = parts.find(p => p.mimeType === 'text/plain')

        if (plainTextPart?.body?.data) {
          const body = Buffer.from(plainTextPart.body.data, 'base64').toString('utf8')
          emailContents.push(body.trim())
        }
      }
    }

    return {
      'plugin.google_mail_summary': emailContents.join('\n\n'),
    }
  },
}
