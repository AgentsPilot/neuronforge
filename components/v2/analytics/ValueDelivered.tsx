'use client'

/**
 * ValueDelivered Component
 *
 * Displays Time Saved, Money Saved, and Tasks Completed metrics
 * with trends and a mini bar chart.
 *
 * Uses V2 theme design system for colors, dark mode support, and fonts.
 */

import React, { useEffect, useState } from 'react'
import { Clock, DollarSign, ArrowUp, ArrowDown } from 'lucide-react'

interface ValueData {
  heroMetrics: {
    hoursAutomated: number
    moneySaved: number
    totalRuns: number
    totalRunsChange: number
  }
  valueMetrics: {
    time_saved_hours: number
    work_days_saved: number
    money_saved_usd: number
    time_saved_change_pct: number
    money_saved_change_pct: number
  }
  businessSettings: {
    hourly_rate_usd: number
    work_hours_per_day: number
  }
  volumeTrends: Array<{
    date: string
    totalRuns: number
  }>
}

interface ValueDeliveredProps {
  className?: string
  timeRange?: '7d' | '30d' | '90d' | 'all'
}

export function ValueDelivered({ className = '', timeRange = '30d' }: ValueDeliveredProps) {
  const [data, setData] = useState<ValueData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/v2/analytics/system-overview?range=${timeRange}`)
      .then(res => res.json())
      .then(response => {
        if (response.success) {
          setData(response.data)
        }
      })
      .catch(err => console.error('Failed to fetch value metrics:', err))
      .finally(() => setLoading(false))
  }, [timeRange])

  // Calculate daily tasks average
  const daysInRange = timeRange === '7d' ? 7 : timeRange === '90d' ? 90 : 30
  const avgTasksPerDay = data?.heroMetrics.totalRuns
    ? Math.round(data.heroMetrics.totalRuns / daysInRange)
    : 0

  // Get last 12 data points for mini chart
  const chartData = data?.volumeTrends?.slice(-12) || []
  const maxRuns = Math.max(...chartData.map(d => d.totalRuns), 1)

  if (loading) {
    return (
      <div className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[var(--v2-radius-card)] p-6 animate-pulse shadow-[var(--v2-shadow-card)] ${className}`}>
        <div className="h-5 w-40 bg-[var(--v2-surface-hover)] rounded mb-4" />
        <div className="space-y-4">
          <div className="h-14 bg-[var(--v2-surface-hover)] rounded-lg" />
          <div className="h-14 bg-[var(--v2-surface-hover)] rounded-lg" />
          <div className="border-t border-[var(--v2-border)]" />
          <div className="h-24 bg-[var(--v2-surface-hover)] rounded-lg" />
        </div>
      </div>
    )
  }

  const timeSavedChange = data?.valueMetrics.time_saved_change_pct ?? 0
  const moneySavedChange = data?.valueMetrics.money_saved_change_pct ?? 0

  return (
    <div className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[var(--v2-radius-card)] p-6 shadow-[var(--v2-shadow-card)] ${className}`}>
      <h2 className="text-lg font-semibold text-[var(--v2-text-primary)] mb-4">Value Delivered This Month</h2>

      {/* Stacked Metrics */}
      <div className="space-y-4">
        {/* Time Saved */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-500/20 rounded-lg">
              <Clock className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-xs text-[var(--v2-text-muted)]">Time Saved</p>
              <p className="text-xl font-bold text-[var(--v2-text-primary)]">
                {Math.round(data?.valueMetrics.time_saved_hours ?? 0)} hours
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              {Math.round(data?.valueMetrics.work_days_saved ?? 0)} work days
            </p>
            <p className={`text-xs ${timeSavedChange >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {timeSavedChange >= 0 ? '↑' : '↓'} {Math.abs(Math.round(timeSavedChange))}%
            </p>
          </div>
        </div>

        {/* Money Saved */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-500/20 rounded-lg">
              <DollarSign className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <p className="text-xs text-[var(--v2-text-muted)]">Money Saved</p>
              <p className="text-xl font-bold text-[var(--v2-text-primary)]">
                ${(data?.valueMetrics.money_saved_usd ?? 0).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-indigo-600 dark:text-indigo-400">
              @${data?.businessSettings.hourly_rate_usd ?? 50}/hr
            </p>
            <p className={`text-xs ${moneySavedChange >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {moneySavedChange >= 0 ? '↑' : '↓'} ${Math.abs(Math.round((data?.valueMetrics.money_saved_usd ?? 0) * (moneySavedChange / 100)))}
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-[var(--v2-border)]" />

        {/* Tasks Completed */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs text-[var(--v2-text-muted)]">Tasks Completed</p>
              <p className="text-xl font-bold text-[var(--v2-text-primary)]">
                {(data?.heroMetrics.totalRuns ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-[var(--v2-text-muted)]">Avg/day</p>
              <p className="text-sm font-semibold text-purple-600 dark:text-purple-400">{avgTasksPerDay}</p>
            </div>
          </div>

          {/* Mini bar chart */}
          <div className="h-12 flex items-end gap-0.5">
            {chartData.map((point, index) => {
              const height = (point.totalRuns / maxRuns) * 100
              const opacity = 0.4 + (index / chartData.length) * 0.6
              return (
                <div
                  key={point.date}
                  className="flex-1 rounded-t bg-purple-500"
                  style={{
                    height: `${Math.max(height, 8)}%`,
                    opacity,
                  }}
                />
              )
            })}
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-[var(--v2-text-muted)]">
            <span>{chartData[0]?.date ? new Date(chartData[0].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
            <span>Today</span>
          </div>
        </div>
      </div>
    </div>
  )
}
