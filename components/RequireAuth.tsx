'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useAuth } from './UserProvider'

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, session } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!session && !user) {
      router.push('/login')
    }
  }, [user, session, router])

  if (session || !user) {
    return <p className="text-center mt-10">Loading...</p>
  }

  return <>{children}</>
}