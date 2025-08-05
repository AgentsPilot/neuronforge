'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useParams } from 'next/navigation'

export default function OAuthCallbackPage() {
  const searchParams = useSearchParams()
  const params = useParams()
  const [status, setStatus] = useState('Waiting for authorization...')

  useEffect(() => {
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')
    const plugin = params.plugin as string

    console.log('🔄 OAuth callback for plugin:', plugin)
    console.log('📋 URL Parameters:', { 
      hasCode: !!code, 
      hasState: !!state, 
      error, 
      errorDescription 
    })

    // Handle OAuth errors
    if (error) {
      console.error('❌ OAuth error:', error, errorDescription)
      const errorMessage = errorDescription || error || 'Authorization failed'
      setStatus(`❌ ${errorMessage}`)
      
      // Send error to parent window
      if (window.opener) {
        console.log('📤 Sending error message to parent for plugin:', plugin)
        window.opener.postMessage({
          type: 'plugin-connected',
          plugin: plugin,
          success: false,
          error: errorMessage
        }, window.location.origin)
      }
      
      setTimeout(() => {
        window.close()
      }, 2000)
      return
    }

    if (!code || !state) {
      console.error('❌ Missing code or state from URL')
      const errorMessage = 'Missing authorization code or state'
      setStatus(`❌ ${errorMessage}`)
      
      if (window.opener) {
        window.opener.postMessage({
          type: 'plugin-connected',
          plugin: plugin,
          success: false,
          error: errorMessage
        }, window.location.origin)
      }
      
      setTimeout(() => {
        window.close()
      }, 2000)
      return
    }

    // Exchange code for token via API
    exchangeCodeViaAPI(code, state, plugin)

  }, [searchParams, params])

  const exchangeCodeViaAPI = async (code: string, state: string, plugin: string) => {
    setStatus('Exchanging authorization code...')

    try {
      console.log('🔄 Making token exchange request via API...')
      const res = await fetch(
        `/api/oauth/token?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}&plugin=${encodeURIComponent(plugin)}`
      )

      console.log('📋 Response status:', res.status, res.statusText)

      if (!res.ok) {
        let errorMessage = 'Authorization failed'
        
        try {
          const errorData = await res.json()
          errorMessage = errorData.error || `HTTP ${res.status}: ${res.statusText}`
          console.error('❌ Token exchange failed (JSON):', errorData)
        } catch (jsonError) {
          console.error('❌ Failed to parse error response as JSON:', jsonError)
          errorMessage = `Authorization failed: ${res.status} ${res.statusText}`
        }

        setStatus(`❌ ${errorMessage}`)

        if (window.opener) {
          console.log('📤 Sending error message to parent for plugin:', plugin)
          window.opener.postMessage({
            type: 'plugin-connected',
            plugin: plugin,
            success: false,
            error: errorMessage
          }, window.location.origin)
        }

        setTimeout(() => {
          window.close()
        }, 3000)
        return
      }

      // Parse the JSON response
      try {
        const result = await res.json()
        console.log('✅ Token exchange successful:', { hasData: !!result.data, success: result.success })
        
        if (result.success) {
          setStatus('✅ Connection successful!')

          if (window.opener) {
            console.log('📤 Sending success message to parent for plugin:', plugin)
            
            // Send the success message
            window.opener.postMessage({
              type: 'plugin-connected',
              plugin: plugin,
              success: true,
              data: result.data
            }, window.location.origin)
            
            console.log('📤 Success message sent, waiting before closing...')
          } else {
            console.warn('⚠️ No opener window found')
          }

          // Wait longer to ensure message is received
          setTimeout(() => {
            console.log('🔄 Closing popup window')
            window.close()
          }, 2000)
          
        } else {
          throw new Error(result.error || 'API returned success: false')
        }
        
      } catch (jsonError) {
        console.error('❌ Failed to parse JSON response:', jsonError)
        const errorMessage = 'Invalid response from server'
        setStatus(`❌ ${errorMessage}`)
        
        if (window.opener) {
          window.opener.postMessage({
            type: 'plugin-connected',
            plugin: plugin,
            success: false,
            error: errorMessage
          }, window.location.origin)
        }
        
        setTimeout(() => {
          window.close()
        }, 3000)
      }

    } catch (err) {
      console.error('❌ Unexpected error:', err)
      const errorMessage = `Unexpected error: ${err instanceof Error ? err.message : 'Unknown error'}`
      setStatus(`❌ ${errorMessage}`)
      
      if (window.opener) {
        window.opener.postMessage({
          type: 'plugin-connected',
          plugin: plugin,
          success: false,
          error: errorMessage
        }, window.location.origin)
      }

      setTimeout(() => {
        window.close()
      }, 3000)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
        {status.includes('❌') ? (
          <>
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Connection Failed</h2>
            <p className="text-slate-600 text-sm mb-4">{status}</p>
            <button 
              onClick={() => window.close()}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Close Window
            </button>
          </>
        ) : status.includes('✅') ? (
          <>
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Success!</h2>
            <p className="text-slate-600">Plugin connected successfully</p>
            <p className="text-xs text-slate-500 mt-2">This window will close automatically</p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Connecting...</h2>
            <p className="text-slate-600">{status}</p>
          </>
        )}
      </div>
    </div>
  )
}