'use client'

import React from 'react'
import { DollarSign } from 'lucide-react'
import { Card } from '@/components/v2/ui/card'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts'
import type { CostTrendPoint, TimeRange } from '@/types/analytics'

interface CostTrendsChartProps {
  data: CostTrendPoint[]
  timeRange: TimeRange
}

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{
    value: number
    dataKey: string
    color: string
    name: string
  }>
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  const total = payload.reduce((sum, item) => sum + item.value, 0)

  return (
    <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg shadow-lg p-3">
      <p className="text-sm font-semibold text-[var(--v2-text-primary)] mb-2">
        {new Date(label || '').toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        })}
      </p>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4 pb-1 border-b border-[var(--v2-border)]">
          <span className="text-xs font-semibold text-[var(--v2-text-secondary)]">Total Investment</span>
          <span className="text-sm font-bold text-[var(--v2-text-primary)]">${total.toFixed(2)}</span>
        </div>
        {payload.map((item, index) => (
          <div key={index} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="text-xs text-[var(--v2-text-secondary)]">{item.name}</span>
            </div>
            <span className="text-sm font-semibold" style={{ color: item.color }}>
              ${item.value.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CostTrendsChart({ data, timeRange }: CostTrendsChartProps) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)

    if (timeRange === '7d') {
      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    }
    if (timeRange === '30d' || timeRange === '90d') {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }

  // If no data, show empty state
  if (!data || data.length === 0) {
    return (
      <Card className="!p-4">
        <div className="flex items-center gap-2 mb-3">
          <DollarSign className="w-5 h-5 text-purple-500" />
          <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
            Investment in Automation
          </h3>
        </div>
        <div className="h-[300px] flex items-center justify-center text-[var(--v2-text-muted)]">
          <div className="text-center">
            <DollarSign className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No cost data available for this period</p>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card className="!p-3 sm:!p-4">
      <div className="flex items-center gap-2 mb-3">
        <DollarSign className="w-5 h-5 text-purple-500" />
        <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
          Investment in Automation
        </h3>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="colorCreation" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.1} />
            </linearGradient>
            <linearGradient id="colorExecution" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0.1} />
            </linearGradient>
            <linearGradient id="colorPlugin" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.1} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="var(--v2-border)" opacity={0.3} />

          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            stroke="var(--v2-text-muted)"
            style={{ fontSize: '12px' }}
            tick={{ fill: 'var(--v2-text-muted)' }}
          />

          <YAxis
            stroke="var(--v2-text-muted)"
            style={{ fontSize: '12px' }}
            tick={{ fill: 'var(--v2-text-muted)' }}
            tickFormatter={(value) => `$${value}`}
          />

          <Tooltip content={<CustomTooltip />} />

          <Legend
            wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
            iconType="rect"
          />

          {/* Stacked areas for cost breakdown */}
          <Area
            type="monotone"
            dataKey="creationCost"
            stackId="1"
            stroke="#3B82F6"
            fill="url(#colorCreation)"
            strokeWidth={2}
            name="Agent Setup"
          />
          <Area
            type="monotone"
            dataKey="executionCost"
            stackId="1"
            stroke="#8B5CF6"
            fill="url(#colorExecution)"
            strokeWidth={2}
            name="Operations"
          />
          <Area
            type="monotone"
            dataKey="pluginCost"
            stackId="1"
            stroke="#F59E0B"
            fill="url(#colorPlugin)"
            strokeWidth={2}
            name="Integrations"
          />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  )
}
