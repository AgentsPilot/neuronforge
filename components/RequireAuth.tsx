'use client'

import { useEffect, useState } from 'react'
import { useAuth } from './UserProvider'
import { marketingLoginUrl } from '@/lib/utils/marketingUrl'

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (user === null) {
      // The sign-in form lives on the marketing site — a different origin, so
      // this has to be a full navigation rather than a client-side push.
      window.location.href = marketingLoginUrl()
    } else {
      setChecking(false)
    }
  }, [user])

  if (checking) {
    return <p className="text-center mt-10">Loading...</p>
  }

  return <>{children}</>
}