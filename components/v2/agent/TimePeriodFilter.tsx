'use client'

import React from 'react'
import { Clock } from 'lucide-react'
import type { TimePeriod } from './AgentHeader'

interface TimePeriodFilterProps {
  timePeriod: TimePeriod
  onTimePeriodChange: (period: TimePeriod) => void
}

export function TimePeriodFilter({ timePeriod, onTimePeriodChange }: TimePeriodFilterProps) {
  return (
    <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-[var(--v2-text-muted)]" />
          <span className="text-sm font-medium text-[var(--v2-text-secondary)]">Time Period:</span>
        </div>
        <div className="flex gap-2">
          {(['24h', '7d', '30d', 'all'] as TimePeriod[]).map((period) => (
            <button
              key={period}
              onClick={() => onTimePeriodChange(period)}
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                timePeriod === period
                  ? 'bg-[var(--v2-primary)] text-white shadow-md'
                  : 'bg-[var(--v2-surface)] text-[var(--v2-text-muted)] hover:bg-[var(--v2-hover)] hover:text-[var(--v2-text-primary)] border border-[var(--v2-border)]'
              }`}
            >
              {period === '24h' && 'Last 24h'}
              {period === '7d' && 'Last 7d'}
              {period === '30d' && 'Last 30d'}
              {period === 'all' && 'All Time'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
