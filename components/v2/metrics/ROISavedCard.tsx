'use client'

import React from 'react'
import { DollarSign } from 'lucide-react'
import type { TimeRange } from '@/types/system-health'

interface ROISavedCardProps {
  moneySaved: number
  timeRange: TimeRange
}

export function ROISavedCard({ moneySaved, timeRange }: ROISavedCardProps) {
  const timeRangeLabels: Record<TimeRange, string> = {
    '24h': '24h',
    '7d': '7d',
    '30d': '30d',
    '90d': '90d',
    'all': 'Total'
  }

  return (
    <div className="rounded-lg p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] transition-all duration-200">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <DollarSign className="w-5 h-5 text-emerald-500" />
        </div>
        <div className="flex-1">
          <div className="text-xs text-[var(--v2-text-muted)]">Saved ({timeRangeLabels[timeRange]})</div>
          {moneySaved > 0 ? (
            <div className="text-lg font-semibold text-emerald-500">
              ${moneySaved.toLocaleString()}
            </div>
          ) : (
            <div className="text-lg font-semibold text-[var(--v2-text-muted)]">
              —
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
