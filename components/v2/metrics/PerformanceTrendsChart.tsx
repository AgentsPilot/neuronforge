'use client'

import React from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Area, AreaChart } from 'recharts'
import { TrendingUp } from 'lucide-react'
import type { TrendDataPoint, TimeRange } from '@/types/system-health'

interface PerformanceTrendsChartProps {
  trends: TrendDataPoint[]
  timeRange: TimeRange
}

export function PerformanceTrendsChart({ trends, timeRange }: PerformanceTrendsChartProps) {
  // Format date for display based on time range
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    if (timeRange === '24h') {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    } else if (timeRange === '7d') {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }
  }

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)] p-3 shadow-lg">
          <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-2">
            {new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
          <div className="space-y-1">
            <p className="text-xs text-green-500">
              Success Rate: {payload[0]?.value}%
            </p>
            <p className="text-xs text-blue-500">
              Total Runs: {payload[1]?.value}
            </p>
          </div>
        </div>
      )
    }
    return null
  }

  if (trends.length === 0) {
    return (
      <div className="rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-[#06B6D4]" />
          <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
            Performance Trends
          </h3>
        </div>
        <div className="text-center py-8">
          <p className="text-sm text-[var(--v2-text-muted)]">No data available</p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-4 h-4 text-[#06B6D4]" />
        <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
          Performance Trends
        </h3>
      </div>

      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={trends} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--v2-border)" opacity={0.3} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            stroke="var(--v2-text-muted)"
            style={{ fontSize: '12px' }}
          />
          <YAxis
            stroke="var(--v2-text-muted)"
            style={{ fontSize: '12px' }}
            domain={[0, 100]}
            label={{ value: 'Success Rate (%)', angle: -90, position: 'insideLeft', style: { fill: 'var(--v2-text-muted)', fontSize: '12px' } }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}
            iconType="line"
          />
          <Line
            type="monotone"
            dataKey="successRate"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ fill: '#10b981', r: 4 }}
            activeDot={{ r: 6 }}
            name="Success Rate (%)"
          />
          <Line
            type="monotone"
            dataKey="totalRuns"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ fill: '#3b82f6', r: 4 }}
            activeDot={{ r: 6 }}
            name="Total Runs"
            yAxisId="right"
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="var(--v2-text-muted)"
            style={{ fontSize: '12px' }}
            label={{ value: 'Total Runs', angle: 90, position: 'insideRight', style: { fill: 'var(--v2-text-muted)', fontSize: '12px' } }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
