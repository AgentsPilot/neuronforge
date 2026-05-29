'use client'

import React from 'react'
import { BarChart3, TrendingUp, TrendingDown } from 'lucide-react'

interface TotalRunsCardProps {
  totalRuns: number
  change: number
}

export function TotalRunsCard({ totalRuns, change }: TotalRunsCardProps) {
  const isPositive = change >= 0
  const TrendIcon = isPositive ? TrendingUp : TrendingDown

  return (
    <div className="rounded-lg p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] transition-all duration-200">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
          <BarChart3 className="w-5 h-5 text-blue-500" />
        </div>
        <div className="flex-1">
          <div className="text-xs text-[var(--v2-text-muted)]">Total Runs</div>
          <div className="flex items-center gap-2">
            <div className="text-lg font-semibold text-[var(--v2-text-primary)]">
              {totalRuns.toLocaleString()}
            </div>
            {change !== 0 && (
              <div className={`flex items-center gap-0.5 text-xs font-medium ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                <TrendIcon className="w-3 h-3" />
                {Math.abs(change).toFixed(1)}%
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
