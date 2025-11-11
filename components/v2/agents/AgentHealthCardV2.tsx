// components/v2/agents/AgentHealthCardV2.tsx
// V2 Card component to display agent health score following V2 design system

'use client'

import { Activity } from 'lucide-react'

interface AgentHealthCardV2Props {
  score: number
  maxScore: number
  percentage: number
  totalRuns: number
  status: string
  recentScore?: number
  recentMaxScore?: number
  failedCount?: number
}

export function AgentHealthCardV2({
  score,
  maxScore,
  percentage,
  totalRuns,
  status,
  recentScore,
  recentMaxScore,
  failedCount
}: AgentHealthCardV2Props) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        {/* Health Score Circle */}
        <div className="relative w-16 h-16">
          <svg className="w-full h-full transform -rotate-90">
            <circle
              cx="32"
              cy="32"
              r="28"
              stroke="currentColor"
              strokeWidth="6"
              fill="none"
              className="text-[var(--v2-border)] opacity-30"
            />
            <circle
              cx="32"
              cy="32"
              r="28"
              stroke="currentColor"
              strokeWidth="6"
              fill="none"
              className="text-[var(--v2-primary)]"
              strokeDasharray={`${(percentage / 100) * 176} 176`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-lg font-bold text-[var(--v2-text-primary)]">
              {score}
            </div>
            <div className="text-[10px] text-[var(--v2-text-muted)]">
              /{maxScore}
            </div>
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-[var(--v2-text-muted)] mb-1">
            Agent Health
          </div>
          <div className="text-2xl font-bold text-[var(--v2-text-primary)]">
            {percentage.toFixed(0)}%
          </div>
          <div className="text-[10px] text-[var(--v2-text-muted)]">
            Success Rate
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[var(--v2-text-muted)]">Total Runs:</span>
          <span className="font-semibold text-[var(--v2-text-primary)]">{totalRuns}</span>
        </div>
        {failedCount !== undefined && failedCount > 0 && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[var(--v2-text-muted)]">Failed:</span>
            <span className="font-semibold text-red-600 dark:text-red-400">{failedCount}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-[var(--v2-text-muted)]">Status:</span>
          <span className={`font-semibold capitalize ${
            status === 'active'
              ? 'text-green-600 dark:text-green-400'
              : 'text-[var(--v2-text-secondary)]'
          }`}>
            {status}
          </span>
        </div>
      </div>
    </div>
  )
}
