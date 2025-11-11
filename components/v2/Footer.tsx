// components/v2/Footer.tsx
// Global footer component for V2 pages with Last Run info and action buttons

'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { DarkModeToggle } from '@/components/v2/DarkModeToggle'
import {
  Clock,
  Activity,
  FileText,
  Plus,
  TrendingUp
} from 'lucide-react'

export function V2Footer() {
  const router = useRouter()
  const { user } = useAuth()
  const [lastRunTime, setLastRunTime] = useState<Date | null>(null)

  useEffect(() => {
    if (!user) return

    const fetchLastRun = async () => {
      try {
        const { data: stats } = await supabase
          .from('agent_stats')
          .select('last_run_at')
          .eq('user_id', user.id)
          .order('last_run_at', { ascending: false })
          .limit(1)
          .single()

        if (stats?.last_run_at) {
          setLastRunTime(new Date(stats.last_run_at))
        }
      } catch (error) {
        console.error('Error fetching last run:', error)
      }
    }

    fetchLastRun()
  }, [user])

  const getTimeAgo = (date: Date | null) => {
    if (!date) return 'Never'
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

    if (hours > 24) return `${Math.floor(hours / 24)}d ago`
    if (hours > 0) return `${hours}h ago`
    if (minutes > 0) return `${minutes}m ago`
    return 'Just now'
  }

  return (
    <div className="mt-6 sm:mt-8 lg:mt-10 pt-3 sm:pt-4 lg:pt-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3">
        {/* Last Run */}
        <div className="flex items-center gap-2 text-sm text-[var(--v2-text-secondary)]">
          <Clock className="w-4 h-4 text-[var(--v2-text-muted)]" />
          <span>Last Run</span>
          <span className="font-medium text-[var(--v2-text-primary)]">
            {getTimeAgo(lastRunTime)}
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 sm:gap-2.5 overflow-x-auto pb-2 sm:pb-0 w-full sm:w-auto">
          {/* Dark Mode Toggle */}
          <DarkModeToggle />

          <button
            onClick={() => router.push('/agents')}
            className="w-9 h-9 sm:w-10 sm:h-10 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] flex items-center justify-center hover:scale-105 transition-transform duration-200 flex-shrink-0"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
            title="View Agents"
          >
            <Activity className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-[#3B82F6]" />
          </button>

          <button
            onClick={() => router.push('/integrations')}
            className="w-9 h-9 sm:w-10 sm:h-10 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] flex items-center justify-center hover:scale-105 transition-transform duration-200 flex-shrink-0"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
            title="Integrations"
          >
            <FileText className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-[#10B981]" />
          </button>

          <button
            onClick={() => router.push('/agents/new')}
            className="w-9 h-9 sm:w-10 sm:h-10 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] flex items-center justify-center hover:scale-105 transition-transform duration-200 flex-shrink-0"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
            title="Create New Agent"
          >
            <Plus className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-[#3B82F6]" />
          </button>

          <button
            onClick={() => router.push('/v2/monitoring')}
            className="w-9 h-9 sm:w-10 sm:h-10 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] flex items-center justify-center hover:scale-105 transition-transform duration-200 flex-shrink-0"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
            title="Monitoring"
          >
            <TrendingUp className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-[#10B981]" />
          </button>
        </div>
      </div>
    </div>
  )
}
