'use client'

import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import type { SystemHealthData, TimeRange } from '@/types/system-health'
import { SystemStatusCard } from './SystemStatusCard'
import { TotalRunsCard } from './TotalRunsCard'
import { SuccessRateCard } from './SuccessRateCard'
import { ROISavedCard } from './ROISavedCard'
import { SystemAlertsCard } from './SystemAlertsCard'
import { PerformanceTrendsChart } from './PerformanceTrendsChart'
import { TopPerformersList } from './TopPerformersList'
import { ChevronDown, RefreshCw } from 'lucide-react'

interface SystemHealthDashboardProps {
  userId: string
  initialTimeRange?: TimeRange
}

export function SystemHealthDashboard({ userId, initialTimeRange = '30d' }: SystemHealthDashboardProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>(initialTimeRange)
  const [data, setData] = useState<SystemHealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showTimeDropdown, setShowTimeDropdown] = useState(false)

  const timeRangeLabels: Record<TimeRange, string> = {
    '24h': 'Last 24 hours',
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    '90d': 'Last 90 days',
    'all': 'All time'
  }

  const fetchSystemHealth = async (range: TimeRange) => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/v6/system-health?range=${range}`)
      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch system health')
      }

      setData(result.data)
    } catch (err) {
      setError((err as Error).message)
      console.error('Failed to fetch system health:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSystemHealth(timeRange)
  }, [timeRange])

  const handleRefresh = () => {
    fetchSystemHealth(timeRange)
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-[var(--v2-primary)] animate-spin" />
          <p className="text-sm text-[var(--v2-text-muted)]">Loading system health...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <p className="text-[var(--v2-error)] font-medium mb-2">Failed to load system health</p>
          <p className="text-sm text-[var(--v2-text-muted)] mb-4">{error}</p>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 bg-[var(--v2-primary)] text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-4">
      {/* Compact Time Range Selector */}
      <div className="flex items-center justify-between">
        <div className="relative">
          <button
            onClick={() => setShowTimeDropdown(!showTimeDropdown)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)] text-xs text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] transition-colors"
          >
            {timeRangeLabels[timeRange]}
            <ChevronDown className="w-3 h-3" />
          </button>

          {showTimeDropdown && (
            <div className="absolute left-0 top-full mt-1 py-0.5 rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg z-10 min-w-[140px]">
              {(Object.keys(timeRangeLabels) as TimeRange[]).map(range => (
                <button
                  key={range}
                  onClick={() => {
                    setTimeRange(range)
                    setShowTimeDropdown(false)
                  }}
                  className={`w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--v2-surface-hover)] transition-colors ${
                    range === timeRange ? 'text-[var(--v2-primary)] font-medium' : 'text-[var(--v2-text-primary)]'
                  }`}
                >
                  {timeRangeLabels[range]}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)] text-xs text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Overview Cards Grid - Compact */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
      >
        <SystemStatusCard
          status={data.overview.status}
          message={data.overview.statusMessage}
        />
        <TotalRunsCard
          totalRuns={data.overview.totalRuns}
          change={data.overview.totalRunsChange}
        />
        <SuccessRateCard
          successRate={data.overview.successRate}
        />
        <ROISavedCard
          moneySaved={data.overview.moneySaved}
          timeRange={timeRange}
        />
      </motion.div>

      {/* System Alerts Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <SystemAlertsCard
          alerts={data.alerts}
          timeRange={timeRange}
        />
      </motion.div>

      {/* Performance Trends and Top Performers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="lg:col-span-2"
        >
          <PerformanceTrendsChart trends={data.trends} timeRange={timeRange} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3 }}
        >
          <TopPerformersList performers={data.topPerformers} />
        </motion.div>
      </div>
    </div>
  )
}
