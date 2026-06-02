'use client'

import React, { useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, TrendingDown, Clock, DollarSign, ChevronDown } from 'lucide-react'
import type { Execution } from '@/lib/repositories/types'

export type TimePeriod = '24h' | '7d' | '30d' | 'all'

interface PerformanceTrendsProps {
  executions: Execution[]
  hourlyRate?: number
  timePeriod: TimePeriod
  onTimePeriodChange: (period: TimePeriod) => void
  manualTimePerItemSeconds?: number | null
}

export function PerformanceTrends({ executions, hourlyRate, timePeriod, onTimePeriodChange, manualTimePerItemSeconds }: PerformanceTrendsProps) {
  // Chart shows different number of executions based on time period
  const chartData = useMemo(() => {
    // Determine how many executions to show based on time period
    let maxExecutions: number
    switch (timePeriod) {
      case '24h':
        maxExecutions = 24 // Show up to 24 runs for last 24 hours
        break
      case '7d':
        maxExecutions = 50 // Show up to 50 runs for last 7 days
        break
      case '30d':
        maxExecutions = 50 // Show up to 50 runs for last 30 days
        break
      case 'all':
        maxExecutions = 100 // Show up to 100 runs for all time
        break
      default:
        maxExecutions = 10
    }

    return executions
      .slice(0, Math.min(maxExecutions, executions.length))
      .reverse()
      .map((exec, index) => ({
        name: `Run ${index + 1}`,
        duration: exec.execution_duration_ms ? Math.round(exec.execution_duration_ms / 1000) : 0,
        success: (exec.status === 'success' || exec.status === 'completed') ? 1 : 0
      }))
  }, [executions, timePeriod])

  // Stats calculated from ALL filtered executions, not just last 10
  const stats = useMemo(() => {
    if (executions.length === 0) return { avgDuration: 0, successRate: 0, trend: 0, totalSaved: 0 }

    // Calculate stats from ALL filtered executions
    const avgDuration = executions.reduce((acc, exec) => acc + (exec.execution_duration_ms || 0), 0) / executions.length / 1000
    const successCount = executions.filter(exec => exec.status === 'success' || exec.status === 'completed').length
    const successRate = (successCount / executions.length) * 100

    // Calculate trend (comparing first half vs second half of ALL filtered executions)
    const midpoint = Math.floor(executions.length / 2)
    const firstHalf = executions.slice(0, midpoint)
    const secondHalf = executions.slice(midpoint)

    const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((acc, exec) => acc + (exec.execution_duration_ms || 0), 0) / firstHalf.length : 0
    const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((acc, exec) => acc + (exec.execution_duration_ms || 0), 0) / secondHalf.length : 0
    const trend = secondAvg && firstAvg ? ((firstAvg - secondAvg) / secondAvg) * 100 : 0

    // Calculate cost saved based on time saved (not agent execution time)
    let totalTimeSavedSeconds = 0
    executions.forEach((exec) => {
      const logs = exec.logs as any
      const timeSaved = logs?.metrics?.time_saved_seconds

      if (timeSaved > 0) {
        // Priority 1: Use actual time_saved_seconds if available in logs
        totalTimeSavedSeconds += timeSaved
      } else if (manualTimePerItemSeconds && manualTimePerItemSeconds > 0) {
        // Priority 2: Calculate from items processed × manual time per item
        // Try multiple sources for items count
        const itemsProcessed =
          logs?.metrics?.total_items ||
          logs?.itemsProcessed ||
          logs?.items_processed ||
          logs?.stepsCompleted ||  // Fallback: use steps as proxy for items
          0
        if (itemsProcessed > 0) {
          totalTimeSavedSeconds += itemsProcessed * manualTimePerItemSeconds
        }
      }
      // No hardcoded fallback - if no data available, cost saved = 0
    })

    const totalSaved = hourlyRate ? (totalTimeSavedSeconds / 3600) * hourlyRate : 0

    return { avgDuration, successRate, trend, totalSaved }
  }, [executions, hourlyRate, manualTimePerItemSeconds])

  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Format currency with K notation for large numbers
  const formatCurrency = (amount: number) => {
    if (amount >= 1000) {
      return `$${(amount / 1000).toFixed(1)}K`
    }
    return `$${amount.toFixed(0)}`
  }

  const getTimePeriodLabel = () => {
    switch (timePeriod) {
      case '24h': return 'Last 24 Hours'
      case '7d': return 'Last 7 Days'
      case '30d': return 'Last 30 Days'
      case 'all': return 'All Time'
    }
  }

  const periods: Array<{ value: TimePeriod; label: string }> = [
    { value: '24h', label: 'Last 24 Hours' },
    { value: '7d', label: 'Last 7 Days' },
    { value: '30d', label: 'Last 30 Days' },
    { value: 'all', label: 'All Time' }
  ]

  return (
    <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl shadow-sm overflow-hidden">
      <div className="p-6 border-b border-[var(--v2-border)] bg-gradient-to-br from-blue-500/5 to-purple-500/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold text-[var(--v2-text-primary)] flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-[var(--v2-primary)]" />
              Performance Trends
            </h3>

            {/* Time Period Filter - Modern Dropdown */}
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--v2-bg)] text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:bg-[var(--v2-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] focus:border-transparent transition-all min-w-[140px] justify-between"
              >
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
                  <span className="text-xs">{getTimePeriodLabel()}</span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-[var(--v2-text-muted)] transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {dropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setDropdownOpen(false)}
                  />
                  <div className="absolute top-full left-0 mt-2 w-full min-w-[140px] bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg shadow-lg overflow-hidden z-20">
                    {periods.map((period) => (
                      <button
                        key={period.value}
                        onClick={() => {
                          onTimePeriodChange(period.value)
                          setDropdownOpen(false)
                        }}
                        className={`w-full px-3 py-2 text-xs text-left transition-colors ${
                          timePeriod === period.value
                            ? 'bg-[var(--v2-primary)] text-white font-medium'
                            : 'text-[var(--v2-text-primary)] hover:bg-[var(--v2-hover)]'
                        }`}
                      >
                        {period.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {chartData.length > 0 && stats.trend !== 0 && (
            <div className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
              stats.trend > 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'
            }`}>
              {stats.trend > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {Math.abs(stats.trend).toFixed(1)}%
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 ? (
        <div className="p-6">
          <div className="h-56 mb-6">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <defs>
                  <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--v2-primary)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--v2-primary)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--v2-border)" opacity={0.5} />
                <XAxis
                  dataKey="name"
                  stroke="var(--v2-border)"
                  tick={{ fontSize: 11, fill: 'var(--v2-text-muted)' }}
                  tickLine={false}
                />
                <YAxis
                  stroke="var(--v2-border)"
                  tick={{ fontSize: 11, fill: 'var(--v2-text-muted)' }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--v2-surface)',
                    border: '1px solid var(--v2-border)',
                    borderRadius: '12px',
                    fontSize: '12px',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    padding: '12px'
                  }}
                  labelStyle={{ color: 'var(--v2-text-primary)', fontWeight: 600 }}
                  formatter={(value: any) => [`${value}s`, 'Duration']}
                />
                <Line
                  type="monotone"
                  dataKey="duration"
                  stroke="var(--v2-primary)"
                  strokeWidth={3}
                  dot={{ fill: 'var(--v2-primary)', r: 4, strokeWidth: 2, stroke: 'var(--v2-surface)' }}
                  activeDot={{ r: 6, strokeWidth: 3 }}
                  fill="url(#colorGradient)"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-px bg-[var(--v2-border)] rounded-xl overflow-hidden">
            <div className="bg-[var(--v2-surface)] p-5 hover:bg-[var(--v2-hover)] transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-blue-500" />
                <div className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">Avg Duration</div>
              </div>
              <div className="text-2xl font-bold text-[var(--v2-text-primary)] tabular-nums">{stats.avgDuration.toFixed(1)}s</div>
            </div>
            <div className="bg-[var(--v2-surface)] p-5 hover:bg-[var(--v2-hover)] transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                <div className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">Success Rate</div>
              </div>
              <div className="text-2xl font-bold text-[var(--v2-text-primary)] tabular-nums">{stats.successRate.toFixed(0)}%</div>
            </div>
            <div className="bg-[var(--v2-surface)] p-5 hover:bg-[var(--v2-hover)] transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4 text-purple-500" />
                <div className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">{hourlyRate ? 'Total Saved' : 'Runs'}</div>
              </div>
              <div className="text-2xl font-bold text-[var(--v2-text-primary)] tabular-nums">
                {hourlyRate ? (
                  stats.totalSaved > 0 ? formatCurrency(stats.totalSaved) : <span className="text-base text-[var(--v2-text-muted)]">Not tracked</span>
                ) : (
                  executions.length
                )}
              </div>
              {hourlyRate && stats.totalSaved > 0 && (
                <div className="text-xs text-[var(--v2-text-muted)] mt-1">
                  {executions.length} runs at ${hourlyRate}/hr
                </div>
              )}
              {hourlyRate && stats.totalSaved === 0 && (
                <div className="text-xs text-[var(--v2-text-muted)] mt-1">
                  Configure ROI tracking
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="h-64 flex flex-col items-center justify-center text-center p-8">
          <div className="w-16 h-16 rounded-full bg-[var(--v2-hover)] flex items-center justify-center mb-4">
            <Clock className="w-8 h-8 text-[var(--v2-text-muted)] opacity-50" />
          </div>
          <p className="text-[var(--v2-text-primary)] font-medium mb-1">No execution data yet</p>
          <p className="text-sm text-[var(--v2-text-muted)]">Run your agent to see performance trends</p>
        </div>
      )}
    </div>
  )
}
