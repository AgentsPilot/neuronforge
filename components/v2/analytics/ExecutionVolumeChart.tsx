'use client'

import React from 'react'
import { BarChart3 } from 'lucide-react'
import { Card } from '@/components/v2/ui/card'
import {
  LineChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts'
import type { VolumeTrendPoint, TimeRange } from '@/types/analytics'

interface ExecutionVolumeChartProps {
  data: VolumeTrendPoint[]
  timeRange: TimeRange
}

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{
    value: number
    dataKey: string
    color: string
    payload: VolumeTrendPoint
  }>
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  const data = payload[0].payload

  // Parse date string directly without Date object to avoid timezone issues
  const formatTooltipDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${monthNames[month - 1]} ${day}, ${year}`
  }

  return (
    <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg shadow-lg p-3">
      <p className="text-sm font-semibold text-[var(--v2-text-primary)] mb-2">
        {formatTooltipDate(label || '')}
      </p>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-[var(--v2-text-secondary)]">Total Operations</span>
          <span className="text-sm font-semibold text-blue-500">{data.totalRuns}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-[var(--v2-text-secondary)]">Success Rate</span>
          <span className="text-sm font-semibold text-green-500">{data.successRate}%</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-[var(--v2-text-secondary)]">Successful</span>
          <span className="text-sm font-medium text-green-500">{data.successfulRuns}</span>
        </div>
        {data.failedRuns > 0 && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-[var(--v2-text-secondary)]">Failed</span>
            <span className="text-sm font-medium text-red-500">{data.failedRuns}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function ExecutionVolumeChart({ data, timeRange }: ExecutionVolumeChartProps) {
  const formatDate = (dateStr: string) => {
    // Parse YYYY-MM-DD string directly without any Date object creation
    const [yearStr, monthStr, dayStr] = dateStr.split('-')
    const year = parseInt(yearStr, 10)
    const month = parseInt(monthStr, 10)
    const day = parseInt(dayStr, 10)

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    if (timeRange === '7d') {
      // For 7d view, we need day of week. Calculate it using Zeller's algorithm to avoid Date objects
      const dayNames = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']
      const adjustedMonth = month < 3 ? month + 12 : month
      const adjustedYear = month < 3 ? year - 1 : year
      const q = day
      const m = adjustedMonth
      const k = adjustedYear % 100
      const j = Math.floor(adjustedYear / 100)
      const h = (q + Math.floor((13 * (m + 1)) / 5) + k + Math.floor(k / 4) + Math.floor(j / 4) - 2 * j) % 7
      const dayOfWeek = dayNames[h]

      return `${dayOfWeek}, ${monthNames[month - 1]} ${day}`
    }
    if (timeRange === '30d' || timeRange === '90d') {
      return `${monthNames[month - 1]} ${day}`
    }
    return `${monthNames[month - 1]} ${year}`
  }

  // Calculate which ticks to show - always include first and last
  const getTicks = () => {
    if (!data || data.length === 0) return undefined

    if (timeRange === '7d') {
      // Show all days for 7-day view
      return data.map(d => d.date)
    }

    if (timeRange === '30d') {
      // Show ~10 ticks: first, last, and evenly distributed
      const indices = [0] // Always show first
      const step = 3 // Show every 3rd day
      for (let i = step; i < data.length - 1; i += step) {
        indices.push(i)
      }
      indices.push(data.length - 1) // Always show last (today)
      return indices.map(i => data[i].date)
    }

    if (timeRange === '90d') {
      // Show ~13 ticks: first, last, and every 7th
      const indices = [0] // Always show first
      const step = 7
      for (let i = step; i < data.length - 1; i += step) {
        indices.push(i)
      }
      indices.push(data.length - 1) // Always show last (today)
      return indices.map(i => data[i].date)
    }

    return undefined // Show all
  }

  // If no data, show empty state
  if (!data || data.length === 0) {
    return (
      <Card className="!p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-5 h-5 text-blue-500" />
          <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
            Execution Volume & Performance
          </h3>
        </div>
        <div className="h-[300px] flex items-center justify-center text-[var(--v2-text-muted)]">
          <div className="text-center">
            <BarChart3 className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No execution data available for this period</p>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card className="!p-3 sm:!p-4">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-5 h-5 text-blue-500" />
        <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
          Execution Volume & Performance
        </h3>
      </div>

      <ResponsiveContainer width="100%" height={300} key={`chart-${timeRange}`}>
        <LineChart data={data} margin={{ top: 10, right: 50, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--v2-border)" opacity={0.3} />

          {/* X-axis: Date */}
          <XAxis
            dataKey="date"
            type="category"
            tickFormatter={formatDate}
            stroke="var(--v2-text-muted)"
            style={{ fontSize: '12px' }}
            tick={{ fill: 'var(--v2-text-muted)' }}
            ticks={getTicks()}
            angle={timeRange === '90d' ? -45 : 0}
            textAnchor={timeRange === '90d' ? 'end' : 'middle'}
            height={timeRange === '90d' ? 70 : 30}
          />

          {/* Left Y-axis: Total Runs */}
          <YAxis
            yAxisId="left"
            stroke="var(--v2-text-muted)"
            style={{ fontSize: '12px' }}
            tick={{ fill: 'var(--v2-text-muted)' }}
          />

          {/* Right Y-axis: Success Rate */}
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="var(--v2-text-muted)"
            style={{ fontSize: '12px' }}
            domain={[0, 100]}
            tick={{ fill: 'var(--v2-text-muted)' }}
            tickFormatter={(value) => `${value}%`}
          />

          <Tooltip content={<CustomTooltip />} />

          <Legend
            wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
            iconType="line"
          />

          {/* Total runs as blue line */}
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="totalRuns"
            stroke="#3B82F6"
            strokeWidth={2}
            dot={(props: any) => {
              const { cx, cy, payload } = props
              // Only show dot if there's actual data
              if (payload.totalRuns > 0) {
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={5}
                    fill="#3B82F6"
                    stroke="#fff"
                    strokeWidth={2}
                  />
                )
              }
              return null
            }}
            activeDot={{ r: 8 }}
            name="Total Operations"
            connectNulls={false}
            isAnimationActive={false}
          />

          {/* Success rate as green line with dots */}
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="successRate"
            stroke="#10B981"
            strokeWidth={2}
            dot={(props: any) => {
              const { cx, cy, payload } = props
              // Only show dot if there's actual data
              if (payload.totalRuns > 0) {
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill="#10B981"
                    stroke="#fff"
                    strokeWidth={1.5}
                  />
                )
              }
              return null
            }}
            activeDot={{ r: 6 }}
            name="Success Rate (%)"
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  )
}
