/**
 * @deprecated This entire file is deprecated and should not be used.
 * Please use the v2 plugin system instead.
 */

// lib/plugins/strategies/gmailPluginStrategy.ts
import type { PluginStrategy } from '../pluginRegistry'

/** @deprecated Use v2 plugin system instead */
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

      // In gmailPluginStrategy.ts, change the scopes array to:
      const scopes = [
        'openid',
        'email',
        'profile', 
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send'  // ← Add this line
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
      authUrl.searchParams.set('access_type', 'offline')
      authUrl.searchParams.set('prompt', 'consent')

      console.log('🔗 OAuth URL generated:', authUrl.toString())
      console.log('🔗 Redirect URI:', redirectUri)

      // Check if popup is valid
      if (!popup || popup.closed) {
        throw new Error('Popup window could not be opened. Please check your browser popup settings.')
      }

      // Redirect popup to OAuth URL
      popup.location.href = authUrl.toString()
      
      console.log('⏳ Waiting for OAuth completion...')
      
      // Listen for OAuth completion
      return new Promise((resolve, reject) => {
        let messageReceived = false
        let popupCheckInterval: NodeJS.Timeout
        let timeoutId: NodeJS.Timeout
        
        const cleanup = () => {
          if (popupCheckInterval) clearInterval(popupCheckInterval)
          if (timeoutId) clearTimeout(timeoutId)
          window.removeEventListener('message', messageHandler)
        }
        
        const messageHandler = (event: MessageEvent) => {
          console.log('📨 Received message from:', event.origin, 'Data:', event.data)
          
          // Security check - only accept messages from same origin
          if (event.origin !== window.location.origin) {
            console.log('🚫 Ignoring message from different origin:', event.origin)
            return
          }
          
          if (event.data.type === 'plugin-connected' && event.data.plugin === 'google-mail') {
            messageReceived = true
            cleanup()
            
            if (event.data.success) {
              console.log('✅ Gmail OAuth completed successfully')
              resolve(event.data.data)
            } else {
              console.log('❌ Gmail OAuth failed:', event.data.error)
              reject(new Error(event.data.error || 'OAuth authentication failed'))
            }
          }
        }

        window.addEventListener('message', messageHandler)
        
        // Check if popup was closed manually - with better timing handling
        popupCheckInterval = setInterval(() => {
          if (popup.closed) {
            if (!messageReceived) {
              // Add a delay to handle race conditions where the callback page
              // might be sending a message just as the popup is detected as closed
              setTimeout(() => {
                if (!messageReceived) {
                  cleanup()
                  console.log('❌ OAuth popup was closed by user before completion')
                  reject(new Error('The authorization window was closed before completing the process. Please try again and make sure to complete the Google authorization.'))
                }
              }, 1000) // Give 1 second for any late messages
            }
          }
        }, 2000) // Check every 2 seconds instead of 1 second to reduce race conditions

        // Add timeout to prevent hanging indefinitely
        timeoutId = setTimeout(() => {
          if (!popup.closed && !messageReceived) {
            cleanup()
            popup.close()
            console.log('❌ OAuth flow timed out')
            reject(new Error('The authorization process timed out. Please try again.'))
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
    console.log('🔄 Handling Gmail OAuth callback...', { hasCode: !!code, hasState: !!state })
    
    try {
      if (!code) {
        throw new Error('Authorization code is missing from the callback')
      }

      if (!state) {
        throw new Error('State parameter is missing from the callback')
      }

      // Parse state
      let parsedState
      try {
        parsedState = JSON.parse(decodeURIComponent(state))
      } catch (parseError) {
        console.error('❌ Failed to parse state:', state)
        throw new Error('Invalid state parameter format')
      }

      const { user_id, plugin_key } = parsedState

      if (plugin_key !== 'google-mail') {
        throw new Error(`Invalid state: expected plugin key 'google-mail', got '${plugin_key}'`)
      }

      if (!user_id) {
        throw new Error('User ID is missing from state parameter')
      }

      console.log('📋 Callback state:', { user_id, plugin_key })

      // Validate environment variables
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        throw new Error('Google OAuth credentials are not configured')
      }

      // Exchange authorization code for tokens
      const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/oauth/callback/google-mail`
      
      console.log('🔄 Exchanging code for tokens...', { redirectUri })
      
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
        console.error('❌ Token exchange failed:', {
          status: tokenResponse.status,
          statusText: tokenResponse.statusText,
          body: errorText
        })
        throw new Error(`Google token exchange failed: ${tokenResponse.status} ${tokenResponse.statusText}`)
      }

      const tokens = await tokenResponse.json()
      
      if (!tokens.access_token) {
        console.error('❌ No access token in response:', tokens)
        throw new Error('Google did not return an access token')
      }

      console.log('✅ Tokens received:', { 
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scope: tokens.scope
      })

      // Fetch user profile
      console.log('🔄 Fetching user profile...')
      const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Accept': 'application/json',
        },
      })

      if (!profileResponse.ok) {
        const profileError = await profileResponse.text()
        console.error('❌ Profile fetch failed:', {
          status: profileResponse.status,
          statusText: profileResponse.statusText,
          body: profileError
        })
        throw new Error(`Failed to fetch Gmail profile: ${profileResponse.status} ${profileResponse.statusText}`)
      }

      const profile = await profileResponse.json()
      
      if (!profile.email) {
        console.error('❌ No email in profile:', profile)
        throw new Error('Google profile does not contain an email address')
      }

      console.log('✅ Profile fetched:', { 
        email: profile.email, 
        verified: profile.verified_email,
        name: profile.name
      })

      // Calculate expiration
      const expiresAt = new Date()
      expiresAt.setSeconds(expiresAt.getSeconds() + (tokens.expires_in || 3600))

      // Store in Supabase
      const connectionData = {
        user_id,
        plugin_key: 'google-mail',
        plugin_name: 'Gmail',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        expires_at: expiresAt.toISOString(),
        scope: tokens.scope || null,
        username: profile.email,
        email: profile.email,
        profile_data: {
          id: profile.id,
          name: profile.name,
          email: profile.email,
          picture: profile.picture,
          verified_email: profile.verified_email
        },
        settings: {},
        status: 'active',
        connected_at: new Date().toISOString()
      }

      console.log('💾 Saving connection to database...')
      
      const { data, error } = await supabase
        .from('plugin_connections')
        .upsert(connectionData, {
          onConflict: 'user_id,plugin_key'
        })
        .select()
        .single()

      if (error) {
        console.error('❌ Database save failed:', error)
        throw new Error(`Failed to save Gmail connection: ${error.message}`)
      }

      console.log('✅ Gmail connection saved successfully')

      return data

    } catch (error) {
      console.error('❌ Gmail OAuth callback error:', error)
      throw error
    }
  }
}