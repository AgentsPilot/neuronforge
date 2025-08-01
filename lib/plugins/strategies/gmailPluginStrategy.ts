// lib/plugins/strategies/gmailStrategy.ts
import type { PluginStrategy } from '../pluginRegistry'

export const gmailStrategy: PluginStrategy = {
  pluginKey: 'google-mail',
  name: 'Gmail',

  // Connect method - initiates OAuth flow
  async connect({ supabase, popup, userId }) {
    try {
      console.log('🔄 Starting Gmail OAuth flow...', { userId })
      
      // Generate state parameter with user info
      const state = JSON.stringify({
        user_id: userId,
        plugin_key: 'google-mail',
        timestamp: Date.now(),
        random: Math.random().toString(36).substring(2)
      })

      // Gmail OAuth scopes - be more specific and minimal
      const scopes = [
        'openid',
        'email',
        'profile'
        // Add Gmail scopes only if needed:
        // 'https://www.googleapis.com/auth/gmail.readonly'
      ].join(' ')

      // Build OAuth URL
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL
      const redirectUri = `${baseUrl}/oauth/callback/google-mail`
      
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      authUrl.searchParams.set('client_id', process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', scopes)
      authUrl.searchParams.set('state', encodeURIComponent(state))
      authUrl.searchParams.set('access_type', 'offline') // Get refresh token
      authUrl.searchParams.set('prompt', 'consent') // Force consent to get refresh token

      console.log('🔗 OAuth URL generated:', authUrl.toString())

      // Redirect popup to OAuth URL
      popup.location.href = authUrl.toString()
      
      console.log('⏳ Waiting for OAuth completion...')
      
      // Listen for OAuth completion
      return new Promise((resolve, reject) => {
        let messageReceived = false;
        
        const messageHandler = (event: MessageEvent) => {
          // Security check - only accept messages from same origin
          if (event.origin !== window.location.origin) {
            console.log('🚫 Ignoring message from different origin:', event.origin)
            return
          }
          
          console.log('📨 Received message:', event.data)
          
          if (event.data.type === 'plugin-connected' && event.data.plugin === 'google-mail') {
            messageReceived = true;
            window.removeEventListener('message', messageHandler)
            clearInterval(checkClosed)
            clearTimeout(timeoutId)
            console.log('✅ Gmail OAuth completed successfully')
            resolve(event.data)
          }
        }

        window.addEventListener('message', messageHandler)
        
        // Check if popup was closed manually
        const checkClosed = setInterval(() => {
          if (popup.closed) {
            if (!messageReceived) {
              clearInterval(checkClosed)
              clearTimeout(timeoutId)
              window.removeEventListener('message', messageHandler)
              console.log('❌ OAuth popup was closed by user before completion')
              reject(new Error('OAuth popup was closed before completing the authorization. Please try again and make sure to complete the Google authorization process.'))
            }
          }
        }, 1000)

        // Add timeout to prevent hanging indefinitely
        const timeoutId = setTimeout(() => {
          if (!popup.closed && !messageReceived) {
            clearInterval(checkClosed)
            window.removeEventListener('message', messageHandler)
            popup.close()
            console.log('❌ OAuth flow timed out')
            reject(new Error('OAuth flow timed out after 5 minutes. Please try again.'))
          }
        }, 300000) // 5 minute timeout
      })

    } catch (error) {
      console.error('❌ Gmail OAuth connect error:', error)
      throw error
    }
  },

  // Handle OAuth callback
  async handleOAuthCallback({ code, state, supabase }) {
    console.log('🔄 Handling Gmail OAuth callback...')
    
    try {
      // Parse state
      const parsedState = JSON.parse(decodeURIComponent(state))
      const { user_id, plugin_key } = parsedState

      if (plugin_key !== 'google-mail') {
        throw new Error('Invalid state: plugin key mismatch')
      }

      console.log('📋 Callback state:', { user_id, plugin_key })

      // Exchange authorization code for tokens
      const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/oauth/callback/google-mail`
      
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      })

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text()
        console.error('❌ Token exchange failed:', errorText)
        throw new Error(`Token exchange failed: ${errorText}`)
      }

      const tokens = await tokenResponse.json()
      console.log('✅ Tokens received:', { 
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in 
      })

      // Fetch user profile
      const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Accept': 'application/json',
        },
      })

      if (!profileResponse.ok) {
        const profileError = await profileResponse.text()
        console.error('❌ Profile fetch failed:', profileError)
        throw new Error(`Failed to fetch Gmail profile: ${profileError}`)
      }

      const profile = await profileResponse.json()
      console.log('✅ Profile fetched:', { 
        email: profile.email, 
        verified: profile.verified_email 
      })

      // Calculate expiration
      const expiresAt = new Date()
      expiresAt.setSeconds(expiresAt.getSeconds() + tokens.expires_in)

      // Return connection data
      return {
        user_id,
        plugin_key: 'google-mail',
        plugin_name: 'Gmail',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt.toISOString(),
        scope: tokens.scope,
        username: profile.email,
        email: profile.email,
        profile_data: {
          id: profile.id,
          name: profile.name,
          email: profile.email,
          picture: profile.picture,
          verified_email: profile.verified_email
        },
        status: 'active'
      }

    } catch (error) {
      console.error('❌ Gmail OAuth callback error:', error)
      throw error
    }
  }
}