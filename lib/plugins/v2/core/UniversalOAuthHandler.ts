import { supabase } from '@/lib/supabaseClient'

export class UniversalOAuthHandler {
  private config: UniversalPluginConfig

  constructor(config: UniversalPluginConfig) {
    this.config = config
  }

  async connect(userId: string, popup: Window): Promise<void> {
    const state = JSON.stringify({
      user_id: userId,
      plugin_key: this.config.pluginKey,
      timestamp: Date.now(),
      random: Math.random().toString(36).substring(2)
    })

    const redirectUri = this.getRedirectUri()
    const authUrl = new URL(this.config.oauth.authUrl)
    
    // Standard OAuth 2.0 parameters
    authUrl.searchParams.set('client_id', this.getClientId())
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', this.config.oauth.scopes.join(' '))
    authUrl.searchParams.set('state', encodeURIComponent(state))
    authUrl.searchParams.set('access_type', 'offline')
    authUrl.searchParams.set('prompt', 'consent')

    // Add custom parameters if specified
    if (this.config.oauth.customParams) {
      Object.entries(this.config.oauth.customParams).forEach(([key, value]) => {
        authUrl.searchParams.set(key, value)
      })
    }

    if (!popup || popup.closed) {
      throw new Error('Popup window could not be opened')
    }

    popup.location.href = authUrl.toString()

    return this.waitForCallback(popup)
  }

  async handleCallback(code: string, state: string): Promise<any> {
    const parsedState = JSON.parse(decodeURIComponent(state))
    const { user_id } = parsedState

    // Exchange code for tokens
    const tokenResponse = await fetch(this.config.oauth.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        client_id: this.getClientId(),
        client_secret: this.getClientSecret(),
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.getRedirectUri(),
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorText}`)
    }

    const tokens = await tokenResponse.json()

    // Get user profile
    const profile = await this.getUserProfile(tokens.access_token)

    // Store connection
    const connectionData = {
      user_id,
      plugin_key: this.config.pluginKey,
      plugin_name: this.config.name,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expires_at: this.calculateExpiry(tokens.expires_in),
      scope: tokens.scope || this.config.oauth.scopes.join(' '),
      username: profile.email || profile.username,
      email: profile.email,
      profile_data: profile,
      settings: {},
      status: 'active',
      connected_at: new Date().toISOString()
    }

    const { data, error } = await supabase
      .from('plugin_connections')
      .upsert(connectionData, { onConflict: 'user_id,plugin_key' })
      .select()
      .single()

    if (error) {
      throw new Error(`Failed to save connection: ${error.message}`)
    }

    return data
  }

  private async getUserProfile(accessToken: string): Promise<any> {
    // Try common profile endpoints
    const profileEndpoints = [
      `${this.config.api.baseUrl}/me`,
      `${this.config.api.baseUrl}/user`,
      `${this.config.api.baseUrl}/profile`,
      'https://www.googleapis.com/oauth2/v2/userinfo' // Google fallback
    ]

    for (const endpoint of profileEndpoints) {
      try {
        const response = await fetch(endpoint, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        })
        
        if (response.ok) {
          return await response.json()
        }
      } catch (error) {
        // Continue to next endpoint
      }
    }

    // Return minimal profile if none work
    return { id: 'unknown', email: null }
  }

  private getClientId(): string {
    return process.env[this.config.oauth.clientIdEnvVar] || ''
  }

  private getClientSecret(): string {
    return process.env[this.config.oauth.clientSecretEnvVar] || ''
  }

  private getRedirectUri(): string {
    const baseUrl = typeof window !== 'undefined' 
      ? window.location.origin 
      : process.env.NEXT_PUBLIC_APP_URL
    
    const path = this.config.oauth.redirectPath || `/oauth/callback/${this.config.pluginKey}`
    return `${baseUrl}${path}`
  }

  private calculateExpiry(expiresIn: number): string {
    const expiresAt = new Date()
    expiresAt.setSeconds(expiresAt.getSeconds() + (expiresIn || 3600))
    return expiresAt.toISOString()
  }

  private waitForCallback(popup: Window): Promise<void> {
    return new Promise((resolve, reject) => {
      let messageReceived = false
      const cleanup = () => {
        window.removeEventListener('message', messageHandler)
      }

      const messageHandler = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return
        
        if (event.data.type === 'plugin-connected' && event.data.plugin === this.config.pluginKey) {
          messageReceived = true
          cleanup()
          
          if (event.data.success) {
            resolve(event.data.data)
          } else {
            reject(new Error(event.data.error || 'OAuth authentication failed'))
          }
        }
      }

      window.addEventListener('message', messageHandler)

      const checkClosed = setInterval(() => {
        if (popup.closed && !messageReceived) {
          clearInterval(checkClosed)
          cleanup()
          reject(new Error('Authorization window was closed'))
        }
      }, 1000)

      setTimeout(() => {
        if (!popup.closed && !messageReceived) {
          clearInterval(checkClosed)
          cleanup()
          popup.close()
          reject(new Error('Authorization timeout'))
        }
      }, 300000)
    })
  }
}