'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { RefreshCw, AlertCircle, Calendar, ChevronDown } from 'lucide-react'
import { HeroMetricsGrid } from './HeroMetricsGrid'
import { ExecutionVolumeChart } from './ExecutionVolumeChart'
import { CostTrendsChart } from './CostTrendsChart'
import { AdvancedToggle } from './AdvancedToggle'
import { AgentBreakdownGrid } from './AgentBreakdownGrid'
import { SystemAlertsSection } from './SystemAlertsSection'
import type { BusinessAnalyticsData, TimeRange } from '@/types/analytics'

interface AnalyticsDashboardProps {
  initialTimeRange?: TimeRange
}

const timeRangeOptions = [
  { value: '7d' as TimeRange, label: 'Last 7 Days' },
  { value: '30d' as TimeRange, label: 'Last 30 Days' },
  { value: '90d' as TimeRange, label: 'Last 90 Days' },
  { value: 'all' as TimeRange, label: 'All Time' },
]

export function AnalyticsDashboard({ initialTimeRange = '30d' }: AnalyticsDashboardProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>(initialTimeRange)
  const [showTimeRangeMenu, setShowTimeRangeMenu] = useState(false)
  const [advancedMode, setAdvancedMode] = useState(() => {
    // Load from localStorage on mount
    if (typeof window !== 'undefined') {
      return localStorage.getItem('analytics-advanced-mode') === 'true'
    }
    return false
  })
  const [data, setData] = useState<BusinessAnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [refreshing, setRefreshing] = useState(false)

  const fetchAnalytics = useCallback(async (isRefresh = false) => {
    try {
      if (!isRefresh) {
        setLoading(true)
      } else {
        setRefreshing(true)
      }
      setError(null)

      const response = await fetch(
        `/api/v2/analytics/system-overview?range=${timeRange}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-correlation-id': crypto.randomUUID(),
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch analytics: ${response.statusText}`)
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to load analytics')
      }

      setData(result.data)
      setLastUpdated(new Date())
    } catch (err) {
      console.error('Analytics fetch error:', err)
      setError(err instanceof Error ? err.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [timeRange])

  // Initial fetch and auto-refresh
  useEffect(() => {
    fetchAnalytics()

    // Auto-refresh every 5 minutes
    const interval = setInterval(() => fetchAnalytics(true), 5 * 60 * 1000)

    return () => clearInterval(interval)
  }, [fetchAnalytics])

  const handleTimeRangeChange = (newRange: TimeRange) => {
    setTimeRange(newRange)
  }

  const handleRefresh = () => {
    fetchAnalytics(true)
  }

  const formatLastUpdated = () => {
    const diffSeconds = Math.floor((Date.now() - lastUpdated.getTime()) / 1000)

    if (diffSeconds < 60) return 'Just now'
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`
    return lastUpdated.toLocaleTimeString()
  }

  // Loading state
  if (loading && !data) {
    return (
      <div className="space-y-4">
        {/* Loading skeleton for hero metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-28 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl animate-pulse"
            />
          ))}
        </div>

        {/* Loading skeleton for charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-[350px] bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl animate-pulse"
            />
          ))}
        </div>
      </div>
    )
  }

  // Error state
  if (error && !data) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="w-5 h-5 text-red-500" />
          <h3 className="text-base font-semibold text-red-900 dark:text-red-100">
            Failed to Load Analytics
          </h3>
        </div>
        <p className="text-sm text-red-700 dark:text-red-300 mb-3">{error}</p>
        <button
          onClick={() => fetchAnalytics()}
          className="px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
        >
          Try Again
        </button>
      </div>
    )
  }

  if (!data) {
    return null
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Control Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3">
        {/* Time Range Selector - Modern Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowTimeRangeMenu(!showTimeRangeMenu)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap bg-[var(--v2-surface)] text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:border-[var(--v2-border-hover)] transition-all rounded-lg"
          >
            <Calendar className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
            {timeRangeOptions.find(o => o.value === timeRange)?.label}
            <ChevronDown className={`w-3.5 h-3.5 text-[var(--v2-text-muted)] transition-transform ${showTimeRangeMenu ? 'rotate-180' : ''}`} />
          </button>

          {showTimeRangeMenu && (
            <>
              <div
                className="fixed inset-0 z-[100]"
                onClick={() => setShowTimeRangeMenu(false)}
              />
              <div
                className="absolute top-full left-0 mt-1 w-44 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-xl z-[101] rounded-lg overflow-hidden"
              >
                {timeRangeOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      handleTimeRangeChange(option.value)
                      setShowTimeRangeMenu(false)
                    }}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                      timeRange === option.value
                        ? 'bg-[var(--v2-primary)] text-white'
                        : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-hover)]'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Advanced Toggle + Refresh */}
        <div className="flex items-center gap-2">
          <AdvancedToggle enabled={advancedMode} onChange={setAdvancedMode} />

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-xs font-medium text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Refresh analytics data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <span className="text-xs text-[var(--v2-text-muted)] whitespace-nowrap">
            Updated {formatLastUpdated()}
          </span>
        </div>
      </div>

      {/* Hero Metrics */}
      <HeroMetricsGrid metrics={data.heroMetrics} timeRange={timeRange} />

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ExecutionVolumeChart data={data.volumeTrends} timeRange={timeRange} />
        <CostTrendsChart data={data.costTrends} timeRange={timeRange} />
      </div>

      {/* Advanced Mode Sections */}
      {advancedMode && (
        <div className="space-y-4">
          {/* System Alerts */}
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-[var(--v2-text-primary)]">
              System Alerts
            </h3>
            <SystemAlertsSection systemHealth={data.systemHealth} timeRange={timeRange} />
          </div>

          {/* Agent Performance Breakdown */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[var(--v2-text-primary)]">
                Agent Performance Breakdown
              </h3>
              <span className="text-xs text-[var(--v2-text-muted)]">
                {data.agentBreakdown.length} active {data.agentBreakdown.length === 1 ? 'automation' : 'automations'}
              </span>
            </div>
            <AgentBreakdownGrid agents={data.agentBreakdown} />
          </div>
        </div>
      )}
    </div>
  )
}
