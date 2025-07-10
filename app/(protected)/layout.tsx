'use client'

import { useAuth } from '@/components/UserProvider'
import { redirect } from 'next/navigation'
import { useEffect } from 'react'

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()

  useEffect(() => {
    if (!user) {
      redirect('/login')
    }
  }, [user])

  // Prevent flashing or redirect loop
  if (!user) return null

  return <>{children}</>
}