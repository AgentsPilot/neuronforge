// app/api/oauth/token/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { pluginRegistry } from '@/lib/plugins/pluginRegistry'
import { savePluginConnection } from '@/lib/plugins/savePluginConnection'

export async function GET(req: NextRequest) {
  const startTime = Date.now()
  console.log('🚀 OAuth token exchange started')
  
  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')

    console.log('📋 OAuth parameters:', { 
      hasCode: !!code, 
      hasState: !!state,
      codeLength: code?.length,
      stateContent: state ? 'present' : 'missing'
    })

    if (!code || !state) {
      console.error('❌ Missing required OAuth parameters')
      return NextResponse.json({ 
        error: 'Missing code or state',
        debug: { hasCode: !!code, hasState: !!state }
      }, { status: 400 })
    }

    // Initialize Supabase - fix cookies issue
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (key) => cookieStore.get(key)?.value,
          set: () => {},
          remove: () => {},
        },
      }
    )

    console.log('🔍 Environment check:', {
      hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasSupabaseKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      hasGoogleClientId: !!process.env.GOOGLE_CLIENT_ID,
      hasGoogleClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
      hasPublicGoogleClientId: !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
      appUrl: process.env.NEXT_PUBLIC_APP_URL
    })

    // Check for missing Google OAuth credentials
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      console.error('❌ Missing Google OAuth credentials')
      return NextResponse.json({ 
        error: 'Server configuration error: Missing Google OAuth credentials',
        details: 'Please check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables'
      }, { status: 500 })
    }

    try {
      // Parse state to get plugin info
      const parsedState = JSON.parse(decodeURIComponent(state))
      const pluginKey = parsedState.plugin_key || 'google-mail'
      
      console.log('📋 Parsed state:', parsedState)
      console.log('🔌 Plugin key:', pluginKey)

      // Get plugin strategy
      const strategy = pluginRegistry[pluginKey]
      if (!strategy) {
        console.error('❌ Unknown plugin strategy:', pluginKey)
        return NextResponse.json({ 
          error: `Unknown plugin "${pluginKey}"`,
          availablePlugins: Object.keys(pluginRegistry)
        }, { status: 404 })
      }

      console.log('✅ Plugin strategy found:', strategy.pluginKey || 'unnamed')

      // Validate strategy has required method
      if (!strategy.handleOAuthCallback) {
        console.error('❌ Strategy missing handleOAuthCallback method')
        return NextResponse.json({ 
          error: 'Invalid plugin configuration',
          details: `Plugin "${pluginKey}" does not support OAuth callback handling`
        }, { status: 500 })
      }

      console.log('🔄 Calling strategy.handleOAuthCallback...')
      
      // Call strategy to handle OAuth
      const connection = await strategy.handleOAuthCallback({ 
        code, 
        state,
        supabase
      })

      if (!connection) {
        console.error('❌ Strategy returned null/undefined connection')
        return NextResponse.json({ 
          error: 'Plugin strategy returned invalid connection data' 
        }, { status: 500 })
      }

      console.log('✅ Strategy returned connection data:', {
        pluginKey: connection.plugin_key,
        hasAccessToken: !!connection.access_token,
        hasRefreshToken: !!connection.refresh_token,
        username: connection.username,
        status: connection.status
      })

      // Save connection to database
      console.log('💾 Saving connection to database...')
      await savePluginConnection(connection)

      const duration = Date.now() - startTime
      console.log('✅ OAuth flow completed successfully:', {
        duration: `${duration}ms`,
        plugin: pluginKey,
        username: connection.username
      })

      // Return success page that notifies parent window
      const successHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Connection Successful</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { 
              font-family: system-ui; 
              display: flex; 
              align-items: center; 
              justify-content: center; 
              height: 100vh; 
              margin: 0; 
              background: #f9fafb; 
            }
            .container { 
              text-align: center; 
              padding: 2rem; 
              background: white; 
              border-radius: 8px; 
              box-shadow: 0 1px 3px rgba(0,0,0,0.1);
              max-width: 400px;
            }
            .success { color: #10b981; }
            .loading { color: #6b7280; }
            .debug { 
              background: #f0f0f0; 
              padding: 1rem; 
              margin: 1rem 0; 
              border-radius: 4px; 
              font-size: 12px; 
              text-align: left;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success">
              <h1>✅ Successfully Connected!</h1>
              <p>Connected to ${connection.plugin_name} as ${connection.username}</p>
              <p class="loading">Closing window in <span id="countdown">3</span> seconds...</p>
            </div>
            <div class="debug">
              <strong>Debug Info:</strong><br>
              Plugin: ${pluginKey}<br>
              Username: ${connection.username}<br>
              Status: ${connection.status}<br>
              Window Origin: <span id="origin"></span><br>
              Has Opener: <span id="hasOpener"></span>
            </div>
          </div>
          <script>
            console.log('🔄 OAuth success page loaded');
            
            // Update debug info
            document.getElementById('origin').textContent = window.location.origin;
            document.getElementById('hasOpener').textContent = !!window.opener;
            
            const messageData = {
              type: 'plugin-connected',
              plugin: '${pluginKey}',
              success: true,
              username: '${connection.username}',
              data: {
                plugin_key: '${connection.plugin_key}',
                username: '${connection.username}',  
                status: '${connection.status}'
              }
            };
            
            console.log('📨 Sending message to parent:', messageData);
            
            // Try multiple ways to notify parent
            if (window.opener) {
              try {
                window.opener.postMessage(messageData, window.location.origin);
                console.log('✅ Message sent to opener');
              } catch (error) {
                console.error('❌ Error sending message to opener:', error);
              }
            } else {
              console.log('❌ No window.opener available');
            }
            
            // Also try parent (in case it's an iframe)
            if (window.parent && window.parent !== window) {
              try {
                window.parent.postMessage(messageData, window.location.origin);
                console.log('✅ Message sent to parent');
              } catch (error) {
                console.error('❌ Error sending message to parent:', error);
              }
            }
            
            // Countdown and close
            let countdown = 3;
            const countdownEl = document.getElementById('countdown');
            const interval = setInterval(() => {
              countdown--;
              if (countdownEl) countdownEl.textContent = countdown;
              if (countdown <= 0) {
                clearInterval(interval);
                console.log('🔄 Attempting to close window');
                try {
                  window.close();
                } catch (error) {
                  console.log('❌ Could not close window automatically:', error);
                  document.querySelector('.loading').innerHTML = 'You can close this window now.';
                }
              }
            }, 1000);
          </script>
        </body>
        </html>
      `;

      return new Response(successHtml, {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
        },
      })

    } catch (parseError) {
      console.error('❌ Error parsing state or calling strategy:', parseError)
      return NextResponse.json({ 
        error: 'Failed to process OAuth callback',
        details: parseError instanceof Error ? parseError.message : 'Unknown error',
        stack: parseError instanceof Error ? parseError.stack : undefined
      }, { status: 500 })
    }

  } catch (err: any) {
    const duration = Date.now() - startTime
    console.error('❌ OAuth token exchange failed:', {
      error: err.message,
      stack: err.stack,
      duration: `${duration}ms`
    })
    
    return NextResponse.json({ 
      error: err.message || 'OAuth token exchange failed',
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}