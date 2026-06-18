'use client'

/**
 * MetricSummaryCard - Universal KPI card with trend indicator
 *
 * Domain-agnostic metric display component. Works for any metric type
 * with universal units (time, count, percentage).
 */

import * as React from 'react'
import { LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/design-system-v2'

export type TrendDirection = 'up' | 'down' | 'stable'
export type MetricVariant = 'primary' | 'success' | 'warning' | 'error' | 'neutral'

export interface MetricSummaryCardProps {
  /** Metric label */
  label: string
  /** Primary value to display */
  value: string | number
  /** Optional subtitle/description */
  subtitle?: string
  /** Trend information */
  trend?: {
    direction: TrendDirection
    value: number // Percentage change
    period?: string // e.g., "vs last week"
  }
  /** Icon to display */
  icon?: LucideIcon
  /** Visual variant */
  variant?: MetricVariant
  /** Click handler */
  onClick?: () => void
  /** Additional CSS classes */
  className?: string
  /** Loading state */
  loading?: boolean
}

const variantStyles: Record<MetricVariant, { bg: string; icon: string; border: string }> = {
  primary: {
    bg: 'from-indigo-500/10 to-purple-500/10',
    icon: 'text-indigo-500 bg-indigo-500/10',
    border: 'border-indigo-200 dark:border-indigo-800',
  },
  success: {
    bg: 'from-emerald-500/10 to-green-500/10',
    icon: 'text-emerald-500 bg-emerald-500/10',
    border: 'border-emerald-200 dark:border-emerald-800',
  },
  warning: {
    bg: 'from-amber-500/10 to-orange-500/10',
    icon: 'text-amber-500 bg-amber-500/10',
    border: 'border-amber-200 dark:border-amber-800',
  },
  error: {
    bg: 'from-red-500/10 to-rose-500/10',
    icon: 'text-red-500 bg-red-500/10',
    border: 'border-red-200 dark:border-red-800',
  },
  neutral: {
    bg: 'from-slate-500/10 to-gray-500/10',
    icon: 'text-slate-500 bg-slate-500/10',
    border: 'border-slate-200 dark:border-slate-700',
  },
}

const trendColors: Record<TrendDirection, string> = {
  up: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400',
  down: 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400',
  stable: 'text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-400',
}

const TrendIcon: Record<TrendDirection, React.FC<{ className?: string }>> = {
  up: TrendingUp,
  down: TrendingDown,
  stable: Minus,
}

export function MetricSummaryCard({
  label,
  value,
  subtitle,
  trend,
  icon: Icon,
  variant = 'primary',
  onClick,
  className,
  loading = false,
}: MetricSummaryCardProps) {
  const styles = variantStyles[variant]
  const TrendIconComponent = trend ? TrendIcon[trend.direction] : null

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl p-6 transition-all duration-200',
        'bg-gradient-to-br border',
        styles.bg,
        styles.border,
        onClick && 'cursor-pointer hover:shadow-lg hover:-translate-y-0.5',
        className
      )}
      onClick={onClick}
    >
      {/* Header with icon and trend */}
      <div className="flex items-start justify-between mb-4">
        {Icon && (
          <div className={cn('p-3 rounded-xl', styles.icon)}>
            <Icon className="h-5 w-5" />
          </div>
        )}
        {trend && TrendIconComponent && (
          <div
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium',
              trendColors[trend.direction]
            )}
          >
            <TrendIconComponent className="h-3 w-3" />
            <span>{Math.abs(trend.value)}%</span>
          </div>
        )}
      </div>

      {/* Value */}
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
          {label}
        </p>
        {loading ? (
          <div className="h-9 w-24 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
        ) : (
          <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
            {value}
          </p>
        )}
        {subtitle && (
          <p className="text-xs text-slate-500 dark:text-slate-500">
            {subtitle}
          </p>
        )}
        {trend?.period && (
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
            {trend.period}
          </p>
        )}
      </div>
    </div>
  )
}
