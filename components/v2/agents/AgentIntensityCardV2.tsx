// components/v2/agents/AgentIntensityCardV2.tsx
// V2 Card component to display agent complexity score following V2 design system

'use client'

import { useState, useEffect, useCallback } from 'react'
import { Brain, Loader2 } from 'lucide-react'
import { useAuth } from '@/components/UserProvider'
import type { IntensityBreakdown } from '@/lib/types/intensity'
import { classifyIntensityRange } from '@/lib/types/intensity'

interface AgentIntensityCardV2Props {
  agentId: string
}

export function AgentIntensityCardV2({ agentId }: AgentIntensityCardV2Props) {
  const { user } = useAuth()
  const [breakdown, setBreakdown] = useState<IntensityBreakdown | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.id || !agentId) return

    let isCancelled = false

    const fetchIntensity = async () => {
      try {
        const response = await fetch(`/api/agents/${agentId}/intensity`, {
          headers: {
            'x-user-id': user.id,
          },
        })

        if (!response.ok) {
          if (!isCancelled) setLoading(false)
          return
        }

        const data = await response.json()
        if (!isCancelled) {
          setBreakdown(data)
          setLoading(false)
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('[AgentIntensityCardV2] Error fetching intensity:', err)
          setLoading(false)
        }
      }
    }

    fetchIntensity()

    return () => {
      isCancelled = true
    }
  }, [agentId, user?.id])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--v2-primary)]" />
      </div>
    )
  }

  if (!breakdown) {
    return (
      <div className="text-center py-8 text-sm text-[var(--v2-text-muted)]">
        AIS data not available
      </div>
    )
  }

  const combinedScore = breakdown.combined_score
  const intensityRange = classifyIntensityRange(combinedScore)
  const hasExecutions = breakdown.details.execution_stats.total_executions > 0

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Brain className="w-6 h-6 sm:w-7 sm:h-7 text-[#6366F1]" />
          <div>
            <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">Agent Complexity</h3>
            <p className="text-[10px] text-[var(--v2-text-muted)]">AIS Score & Model</p>
          </div>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
          combinedScore < 3
            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
            : combinedScore < 6
            ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
            : combinedScore < 8
            ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
            : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
        }`}>
          {intensityRange} {!hasExecutions && '(est)'}
        </span>
      </div>

      {/* Main Score */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-end gap-1.5">
            <div className="text-3xl font-bold text-[var(--v2-text-primary)]">
              {combinedScore.toFixed(1)}
            </div>
            <div className="text-sm text-[var(--v2-text-muted)] mb-1">/10</div>
          </div>
          <div className="text-xs text-[var(--v2-text-muted)]">
            Multiplier: <span className="font-semibold text-[var(--v2-text-primary)]">{breakdown.combined_multiplier.toFixed(2)}x</span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="relative h-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${
              combinedScore < 3
                ? 'bg-green-500'
                : combinedScore < 6
                ? 'bg-yellow-500'
                : combinedScore < 8
                ? 'bg-orange-500'
                : 'bg-red-500'
            }`}
            style={{ width: `${(combinedScore / 10) * 100}%` }}
          />
        </div>
      </div>

      {/* Score Breakdown */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {/* Creation Complexity */}
        <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-3">
          <div className="text-[10px] font-medium text-[var(--v2-text-muted)] mb-1">
            Creation
          </div>
          <div className="text-xl font-bold text-[var(--v2-text-primary)] mb-0.5">
            {breakdown.creation_score.toFixed(1)}
          </div>
          <div className="text-[10px] text-[var(--v2-text-muted)]">
            30% weight
          </div>
        </div>

        {/* Runtime Complexity */}
        <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-3">
          <div className="text-[10px] font-medium text-[var(--v2-text-muted)] mb-1">
            Runtime
          </div>
          <div className="text-xl font-bold text-[var(--v2-text-primary)] mb-0.5">
            {breakdown.execution_score.toFixed(1)}
          </div>
          <div className="text-[10px] text-[var(--v2-text-muted)]">
            70% weight
          </div>
        </div>
      </div>

      {/* Pilot Credits */}
      <div className="grid grid-cols-2 gap-2">
        {/* Creation Credits */}
        <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-2">
          <div className="text-[10px] text-[var(--v2-text-muted)] mb-0.5">Creation</div>
          <div className="text-base font-bold text-[var(--v2-text-primary)]">
            {breakdown.details?.creation_stats?.creation_tokens_used
              ? Math.ceil(breakdown.details.creation_stats.creation_tokens_used / 10).toLocaleString()
              : '0'}
          </div>
        </div>

        {/* Execution Credits */}
        <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-2">
          <div className="text-[10px] text-[var(--v2-text-muted)] mb-0.5">Execution</div>
          <div className="text-base font-bold text-[var(--v2-text-primary)]">
            {breakdown.details?.token_stats?.total_tokens
              ? Math.ceil(breakdown.details.token_stats.total_tokens / 10).toLocaleString()
              : '0'}
          </div>
        </div>
      </div>
    </>
  )
}
