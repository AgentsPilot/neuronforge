'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAuth } from './UserProvider'

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (user === null) {
      router.push('/login')
    } else {
      setChecking(false)
    }
  }, [user])

  if (checking) {
    return <p className="text-center mt-10">Loading...</p>
  }

  return <>{children}</>
}