'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function OAuthCallbackPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState('Waiting for authorization...')

  useEffect(() => {
    const code = searchParams.get('code')
    const state = searchParams.get('state')

    if (!code || !state) {
      console.error('❌ Missing code or state from URL')
      setStatus('Missing code or state from URL')
      return
    }

    const exchangeCode = async () => {
      setStatus('Exchanging code for token...')

      try {
        const res = await fetch(
          `/api/oauth/token?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
        )

        if (!res.ok) {
          const text = await res.text()
          console.error('❌ Token exchange failed:', text)

          if (text.includes('redirect_uri_mismatch')) {
            setStatus('Redirect URI mismatch. Check Google Console.')
          } else if (text.includes('invalid_grant')) {
            setStatus('Authorization expired. Try again.')
          } else {
            setStatus('Token exchange failed. See logs.')
          }

          return
        }

        setStatus('✅ Plugin connected successfully!')

        // ✅ Notify parent window
        if (window.opener) {
          window.opener.postMessage({ type: 'plugin-connected' }, '*')
        }

        // Give it time to propagate
        setTimeout(() => {
          window.close()
        }, 1000)
      } catch (err) {
        console.error('❌ Unexpected error:', err)
        setStatus('Unexpected error. See console.')
      }
    }

    exchangeCode()
  }, [searchParams])

  return (
    <div className="p-8 text-center">
      <h2 className="text-xl font-bold">Plugin Connection</h2>
      <p className="text-gray-600 mt-4">{status}</p>
    </div>
  )
}