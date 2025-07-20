'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function OAuthCallbackPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState('Waiting for code...')

  useEffect(() => {
    const code = searchParams.get('code')
    const state = searchParams.get('state')

    if (!code || !state) {
      console.error('❌ Missing code or state from URL')
      setStatus('Missing code or state from URL')
      return
    }

    const sendTokenToBackend = async () => {
      try {
        const res = await fetch(`/api/oauth/token?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`)
        if (!res.ok) {
          const text = await res.text()
          console.error('❌ Failed to exchange token:', text)
          setStatus('Token exchange failed. Check logs.')
          return
        }

        setStatus('✅ Connected! You can close this window.')

        // Notify parent window
        if (window.opener) {
          window.opener.postMessage({ type: 'plugin-connected' }, window.origin)
        }

        // Delay to allow postMessage before closing
        setTimeout(() => window.close(), 1000)
      } catch (err) {
        console.error('❌ Unexpected error:', err)
        setStatus('Unexpected error')
      }
    }

    sendTokenToBackend()
  }, [searchParams])

  return (
    <div className="p-8 text-center">
      <h2 className="text-xl font-bold">OAuth Callback</h2>
      <p className="text-gray-600 mt-4">{status}</p>
    </div>
  )
}