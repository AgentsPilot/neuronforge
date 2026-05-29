'use client'

import React from 'react'
import { CheckCircle } from 'lucide-react'

interface SuccessRateCardProps {
  successRate: number
}

export function SuccessRateCard({ successRate }: SuccessRateCardProps) {
  const getColor = (rate: number) => {
    if (rate >= 95) return 'text-green-500'
    if (rate >= 90) return 'text-yellow-500'
    return 'text-red-500'
  }

  const getBgColor = (rate: number) => {
    if (rate >= 95) return 'from-green-500/10 to-emerald-500/10 border-green-500/20'
    if (rate >= 90) return 'from-yellow-500/10 to-orange-500/10 border-yellow-500/20'
    return 'from-red-500/10 to-rose-500/10 border-red-500/20'
  }

  return (
    <div className="rounded-lg p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] transition-all duration-200">
      <div className="flex items-center gap-3">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
          successRate >= 95 ? 'bg-green-500/10' : successRate >= 90 ? 'bg-yellow-500/10' : 'bg-red-500/10'
        }`}>
          <CheckCircle className={`w-5 h-5 ${getColor(successRate)}`} />
        </div>
        <div className="flex-1">
          <div className="text-xs text-[var(--v2-text-muted)]">Success Rate</div>
          <div className={`text-lg font-semibold ${getColor(successRate)}`}>
            {successRate}%
          </div>
        </div>
      </div>
    </div>
  )
}
