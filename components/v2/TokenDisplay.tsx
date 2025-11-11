'use client'

import React, { useState, useEffect } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { Coins } from 'lucide-react'

export function TokenDisplay() {
  const { user } = useAuth()
  const [balance, setBalance] = useState<number>(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return

    const fetchBalance = async () => {
      try {
        const { data: subscription } = await supabase
          .from('user_subscriptions')
          .select('balance')
          .eq('user_id', user.id)
          .single()

        if (subscription?.balance) {
          setBalance(subscription.balance)
        }
      } catch (error) {
        console.error('Error fetching token balance:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchBalance()

    // Refresh balance every 30 seconds
    const interval = setInterval(fetchBalance, 30000)
    return () => clearInterval(interval)
  }, [user])

  const formatBalance = (tokens: number) => {
    // Convert tokens to Pilot Credits (assuming 10 tokens per credit as in billing)
    const pilotCredits = Math.floor(tokens / 10)
    return new Intl.NumberFormat().format(pilotCredits)
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
        <div className="w-4 h-4 border-2 border-[var(--v2-primary)] border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] hover:scale-105 transition-all duration-200 cursor-default"
      style={{ borderRadius: 'var(--v2-radius-button)' }}
      title="Available Pilot Credits"
    >
      <Coins className="w-4 h-4 text-[var(--v2-primary)]" />
      <span className="text-sm font-semibold text-[var(--v2-text-primary)]">
        {formatBalance(balance)}
      </span>
    </div>
  )
}
