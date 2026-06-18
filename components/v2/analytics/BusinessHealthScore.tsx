'use client'

/**
 * BusinessHealthScore Component
 *
 * Displays the Business Health Score with circular progress ring
 * and breakdown bars for Reliability, Efficiency, and Coverage.
 *
 * Uses V2 theme design system for colors, dark mode support, and fonts.
 */

import React, { useEffect, useState } from 'react'

interface HealthScoreData {
  score: number
  status: 'excellent' | 'good' | 'warning' | 'critical'
  breakdown: {
    reliability: number
    efficiency: number
    coverage: number
  }
}

interface BusinessHealthScoreProps {
  className?: string
}

export function BusinessHealthScore({ className = '' }: BusinessHealthScoreProps) {
  const [data, setData] = useState<HealthScoreData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v2/analytics/health-score')
      .then(res => res.json())
      .then(response => {
        if (response.success) {
          setData(response.data)
        }
      })
      .catch(err => console.error('Failed to fetch health score:', err))
      .finally(() => setLoading(false))
  }, [])

  // Calculate SVG circle properties
  const radius = 70
  const circumference = 2 * Math.PI * radius
  const score = data?.score ?? 0
  const strokeDashoffset = circumference - (score / 100) * circumference

  // Status colors - using semantic colors that work in both modes
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'excellent': return 'var(--v2-success, #10b981)'
      case 'good': return 'var(--v2-primary, #6366F1)'
      case 'warning': return 'var(--v2-warning, #f59e0b)'
      case 'critical': return 'var(--v2-error, #ef4444)'
      default: return 'var(--v2-success, #10b981)'
    }
  }

  const getStatusBadgeClasses = (status: string) => {
    switch (status) {
      case 'excellent': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
      case 'good': return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400'
      case 'warning': return 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
      case 'critical': return 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'
      default: return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
    }
  }

  if (loading) {
    return (
      <div className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[var(--v2-radius-card)] p-6 h-full animate-pulse shadow-[var(--v2-shadow-card)] ${className}`}>
        <div className="h-6 w-32 bg-[var(--v2-surface-hover)] rounded mb-4" />
        <div className="flex justify-center my-8">
          <div className="w-40 h-40 rounded-full bg-[var(--v2-surface-hover)]" />
        </div>
        <div className="space-y-3">
          <div className="h-4 bg-[var(--v2-surface-hover)] rounded" />
          <div className="h-4 bg-[var(--v2-surface-hover)] rounded" />
          <div className="h-4 bg-[var(--v2-surface-hover)] rounded" />
        </div>
      </div>
    )
  }

  return (
    <div className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[var(--v2-radius-card)] p-6 h-full shadow-[var(--v2-shadow-card)] ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">Business Health</h2>
        <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${getStatusBadgeClasses(data?.status || 'excellent')}`}>
          {data?.status || 'Excellent'}
        </span>
      </div>

      {/* Large Health Score Circle */}
      <div className="flex justify-center my-8">
        <div className="relative">
          <svg className="w-40 h-40" style={{ transform: 'rotate(-90deg)' }}>
            {/* Background circle */}
            <circle
              cx="80"
              cy="80"
              r={radius}
              stroke="var(--v2-border)"
              strokeWidth="8"
              fill="none"
            />
            {/* Progress circle */}
            <circle
              cx="80"
              cy="80"
              r={radius}
              stroke={getStatusColor(data?.status || 'excellent')}
              strokeWidth="8"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.5s ease-in-out' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-4xl font-bold text-[var(--v2-text-primary)]">{score}</span>
            <span className="text-sm text-[var(--v2-text-muted)]">out of 100</span>
          </div>
        </div>
      </div>

      {/* Health Breakdown */}
      <div className="space-y-3">
        {/* Reliability */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--v2-text-secondary)]">Reliability</span>
          <div className="flex items-center gap-2">
            <div className="w-24 h-2 bg-[var(--v2-surface-hover)] rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${data?.breakdown.reliability ?? 0}%` }}
              />
            </div>
            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400 w-10 text-right">
              {data?.breakdown.reliability ?? 0}%
            </span>
          </div>
        </div>

        {/* Efficiency */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--v2-text-secondary)]">Efficiency</span>
          <div className="flex items-center gap-2">
            <div className="w-24 h-2 bg-[var(--v2-surface-hover)] rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${data?.breakdown.efficiency ?? 0}%` }}
              />
            </div>
            <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400 w-10 text-right">
              {data?.breakdown.efficiency ?? 0}%
            </span>
          </div>
        </div>

        {/* Coverage */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--v2-text-secondary)]">Coverage</span>
          <div className="flex items-center gap-2">
            <div className="w-24 h-2 bg-[var(--v2-surface-hover)] rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 rounded-full transition-all duration-500"
                style={{ width: `${data?.breakdown.coverage ?? 0}%` }}
              />
            </div>
            <span className="text-sm font-medium text-purple-600 dark:text-purple-400 w-10 text-right">
              {data?.breakdown.coverage ?? 0}%
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
