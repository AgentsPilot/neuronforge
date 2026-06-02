'use client'

import React from 'react'
import { DollarSign, TrendingUp, TrendingDown, CheckCircle, AlertCircle, Zap, Info, Minus } from 'lucide-react'
import { Card } from '@/components/v2/ui/card'

interface HeroMetrics {
  totalRuns: number
  totalRunsChange: number // percentage
  successRate: number // 0-100
  moneySaved: number // USD
  costPerExecution: number // USD
  hoursAutomated: number
}

interface HeroMetricsGridProps {
  metrics: HeroMetrics
  timeRange: '7d' | '30d' | '90d' | 'all'
}

interface MetricCardProps {
  icon: React.ElementType
  iconColor: string
  iconBg: string
  label: string
  value: string
  subtext: string
  trend?: number // percentage change
  trendLabel?: string
  tooltip?: string
  invertTrend?: boolean // For metrics where negative is good (like cost)
}

function MetricCard({
  icon: Icon,
  iconColor,
  iconBg,
  label,
  value,
  subtext,
  trend,
  trendLabel,
  tooltip,
  invertTrend = false
}: MetricCardProps) {
  const getTrendIcon = (change: number) => {
    if (Math.abs(change) < 0.1) return Minus
    if (invertTrend) {
      return change > 0 ? TrendingDown : TrendingUp
    }
    return change > 0 ? TrendingUp : TrendingDown
  }

  const getTrendColor = (change: number) => {
    if (Math.abs(change) < 0.1) return 'text-gray-500'
    if (invertTrend) {
      return change > 0 ? 'text-red-500' : 'text-green-500'
    }
    return change > 0 ? 'text-green-500' : 'text-red-500'
  }

  const TrendIcon = trend !== undefined ? getTrendIcon(trend) : null

  return (
    <Card className="!p-3 sm:!p-4 border border-[var(--v2-border)] hover:shadow-md transition-shadow">
      <div className="flex items-start gap-2.5 mb-2">
        <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${iconColor} flex-shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-xs text-[var(--v2-text-muted)] font-medium truncate">
              {label}
            </span>
            {tooltip && (
              <div className="group relative flex-shrink-0">
                <Info className="w-3 h-3 text-[var(--v2-text-muted)] opacity-50 cursor-help" />
                <div className="absolute left-0 top-full mt-1 w-56 p-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                  {tooltip}
                </div>
              </div>
            )}
          </div>
          <div className="text-xl sm:text-2xl font-bold text-[var(--v2-text-primary)] tabular-nums">
            {value}
          </div>
        </div>
      </div>

      <div className="text-xs text-[var(--v2-text-muted)] mb-1.5">{subtext}</div>

      {trend !== undefined && TrendIcon && (
        <div className={`flex items-center gap-1 text-xs font-semibold ${getTrendColor(trend)}`}>
          <TrendIcon className="w-3 h-3" />
          <span>
            {Math.abs(trend) < 0.1 ? 'No change' : `${trend > 0 ? '+' : ''}${trend.toFixed(1)}%`}
            {trendLabel && ` ${trendLabel}`}
          </span>
        </div>
      )}
    </Card>
  )
}

export function HeroMetricsGrid({ metrics, timeRange }: HeroMetricsGridProps) {
  // Format large numbers with K/M suffixes
  const formatNumber = (num: number): string => {
    if (num === 0) return '0'
    if (num < 1000) return num.toLocaleString()
    if (num < 1000000) return `${(num / 1000).toFixed(1)}K`
    return `${(num / 1000000).toFixed(1)}M`
  }

  // Calculate derived metrics
  const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : 365
  const runsPerDay = metrics.totalRuns > 0 ? Math.round(metrics.totalRuns / days) : 0
  const failedRuns = metrics.totalRuns > 0
    ? Math.round(metrics.totalRuns * (1 - metrics.successRate / 100))
    : 0

  // Determine success rate status
  const getSuccessIcon = (rate: number) => {
    if (rate >= 95) return CheckCircle
    return AlertCircle
  }

  const getSuccessColor = (rate: number) => {
    if (rate >= 95) return 'text-green-500'
    if (rate >= 90) return 'text-yellow-500'
    return 'text-red-500'
  }

  const getSuccessBg = (rate: number) => {
    if (rate >= 95) return 'bg-green-500/10'
    if (rate >= 90) return 'bg-yellow-500/10'
    return 'bg-red-500/10'
  }

  const getRangeName = () => {
    switch (timeRange) {
      case '7d': return 'last 7 days'
      case '30d': return 'last 30 days'
      case '90d': return 'last 90 days'
      case 'all': return 'all time'
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      {/* 1. ROI Savings Card */}
      <MetricCard
        icon={DollarSign}
        iconColor="text-emerald-500"
        iconBg="bg-emerald-500/10"
        label="Savings from Automation"
        value={`$${formatNumber(metrics.moneySaved)}`}
        subtext={`${metrics.hoursAutomated.toFixed(1)} hours automated`}
        trend={metrics.totalRunsChange}
        trendLabel={`vs previous ${getRangeName()}`}
        tooltip="Total labor cost saved based on manual time estimates and your hourly rate"
      />

      {/* 2. Total Operations Card */}
      <MetricCard
        icon={TrendingUp}
        iconColor="text-blue-500"
        iconBg="bg-blue-500/10"
        label="Total Operations"
        value={formatNumber(metrics.totalRuns)}
        subtext={`${runsPerDay} runs/day average`}
        trend={metrics.totalRunsChange}
        trendLabel="growth"
        tooltip="Total number of automated operations run in this period"
      />

      {/* 3. Reliability Score Card */}
      <MetricCard
        icon={getSuccessIcon(metrics.successRate)}
        iconColor={getSuccessColor(metrics.successRate)}
        iconBg={getSuccessBg(metrics.successRate)}
        label="Reliability Score"
        value={`${metrics.successRate}%`}
        subtext={failedRuns > 0 ? `${failedRuns} operations need attention` : 'All operations successful'}
        tooltip="Percentage of operations that completed without errors"
      />

      {/* 4. Cost Efficiency Card */}
      <MetricCard
        icon={Zap}
        iconColor="text-purple-500"
        iconBg="bg-purple-500/10"
        label="Automation Efficiency"
        value={`$${metrics.costPerExecution.toFixed(3)}`}
        subtext="platform cost per execution"
        tooltip="Platform cost per automated operation - lower is better"
        invertTrend={true}
      />
    </div>
  )
}
