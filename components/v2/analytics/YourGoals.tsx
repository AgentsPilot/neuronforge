'use client'

/**
 * YourGoals Component
 *
 * Displays SLA-based goals with progress bars.
 * Shows status as Exceeding, Meeting, On Track, At Risk, or Behind.
 *
 * Uses V2 theme design system for colors, dark mode support, and fonts.
 */

import React, { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'

interface GoalData {
  id: string
  label: string
  current_value: number
  goal_value: number
  unit: string
  status: 'exceeding' | 'meeting' | 'on_track' | 'at_risk' | 'behind'
  progress_pct: number
}

interface YourGoalsProps {
  className?: string
  onAddGoalClick?: () => void
}

export function YourGoals({ className = '', onAddGoalClick }: YourGoalsProps) {
  const [goals, setGoals] = useState<GoalData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fetch SLAs and transform to goals
    fetch('/api/v2/slas')
      .then(res => res.json())
      .then(response => {
        if (response.success && response.data?.slas) {
          // Transform SLAs to goal format
          const transformedGoals: GoalData[] = response.data.slas
            .filter((sla: any) => sla.status !== 'paused')
            .slice(0, 4)
            .map((sla: any) => {
              const current = sla.current_value ?? 0
              const target = sla.target_value ?? 100
              let progress = 0
              let status: GoalData['status'] = 'on_track'

              // Calculate progress based on threshold_type
              // 'above' means higher is better (e.g., success rate >= 95%)
              // 'below' means lower is better (e.g., duration <= 5000ms)
              if (sla.threshold_type === 'above') {
                // Higher is better (e.g., success rate)
                progress = target > 0 ? Math.min((current / target) * 100, 100) : 0
                if (current >= target * 1.05) status = 'exceeding'
                else if (current >= target) status = 'meeting'
                else if (current >= target * 0.9) status = 'on_track'
                else if (current >= target * 0.75) status = 'at_risk'
                else status = 'behind'
              } else {
                // Lower is better (e.g., duration)
                progress = target > 0 ? Math.min((target / Math.max(current, 1)) * 100, 100) : 0
                if (current <= target * 0.8) status = 'exceeding'
                else if (current <= target) status = 'meeting'
                else if (current <= target * 1.1) status = 'on_track'
                else if (current <= target * 1.25) status = 'at_risk'
                else status = 'behind'
              }

              return {
                id: sla.id,
                label: sla.name || sla.metric_name?.replace(/_/g, ' ') || 'Goal',
                current_value: current,
                goal_value: target,
                unit: getUnitForMetric(sla.metric_name || ''),
                status,
                progress_pct: Math.round(progress),
              }
            })

          setGoals(transformedGoals)
        }
      })
      .catch(err => console.error('Failed to fetch SLAs:', err))
      .finally(() => setLoading(false))
  }, [])

  const getUnitForMetric = (metricType: string): string => {
    if (metricType.includes('rate')) return '%'
    if (metricType.includes('duration') || metricType.includes('time')) return 's'
    if (metricType.includes('count') || metricType.includes('tasks')) return ''
    if (metricType.includes('cost') || metricType.includes('savings')) return '$'
    return ''
  }

  const formatValue = (value: number, unit: string): string => {
    if (unit === '$') return `$${value.toLocaleString()}`
    if (unit === '%') return `${value}%`
    if (unit === 's') return `${value}s`
    return value.toLocaleString()
  }

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'exceeding':
        return {
          label: 'Exceeding',
          bgColor: 'bg-emerald-100 dark:bg-emerald-500/20',
          textColor: 'text-emerald-700 dark:text-emerald-400',
          barColor: 'bg-emerald-500',
        }
      case 'meeting':
        return {
          label: 'Meeting',
          bgColor: 'bg-emerald-100 dark:bg-emerald-500/20',
          textColor: 'text-emerald-700 dark:text-emerald-400',
          barColor: 'bg-emerald-500',
        }
      case 'on_track':
        return {
          label: 'On Track',
          bgColor: 'bg-indigo-100 dark:bg-indigo-500/20',
          textColor: 'text-indigo-700 dark:text-indigo-400',
          barColor: 'bg-indigo-500',
        }
      case 'at_risk':
        return {
          label: 'At Risk',
          bgColor: 'bg-amber-100 dark:bg-amber-500/20',
          textColor: 'text-amber-700 dark:text-amber-400',
          barColor: 'bg-amber-500',
        }
      case 'behind':
        return {
          label: 'Behind',
          bgColor: 'bg-red-100 dark:bg-red-500/20',
          textColor: 'text-red-700 dark:text-red-400',
          barColor: 'bg-red-500',
        }
      default:
        return {
          label: 'Unknown',
          bgColor: 'bg-gray-100 dark:bg-gray-500/20',
          textColor: 'text-gray-700 dark:text-gray-400',
          barColor: 'bg-gray-500',
        }
    }
  }

  if (loading) {
    return (
      <div className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[var(--v2-radius-card)] p-6 animate-pulse shadow-[var(--v2-shadow-card)] ${className}`}>
        <div className="flex items-center justify-between mb-6">
          <div className="h-6 w-24 bg-[var(--v2-surface-hover)] rounded" />
          <div className="h-8 w-24 bg-[var(--v2-surface-hover)] rounded" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="h-28 bg-[var(--v2-surface-hover)] rounded-xl" />
          <div className="h-28 bg-[var(--v2-surface-hover)] rounded-xl" />
          <div className="h-28 bg-[var(--v2-surface-hover)] rounded-xl" />
          <div className="h-28 bg-[var(--v2-surface-hover)] rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <div className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[var(--v2-radius-card)] p-6 shadow-[var(--v2-shadow-card)] ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">Your Goals</h2>
          <p className="text-sm text-[var(--v2-text-muted)]">
            Standards you've set for your automations
          </p>
        </div>
        <button
          onClick={onAddGoalClick}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--v2-text-secondary)] border border-[var(--v2-border)] rounded-lg hover:text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)] transition"
        >
          <Plus className="w-4 h-4" />
          Add Goal
        </button>
      </div>

      {goals.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-[var(--v2-text-muted)]">
            No goals defined yet. Set targets to track your automation performance.
          </p>
          <button
            onClick={onAddGoalClick}
            className="mt-4 px-4 py-2 bg-[var(--v2-surface-hover)] text-[var(--v2-text-secondary)] rounded-lg hover:text-[var(--v2-text-primary)] transition text-sm"
          >
            Create Your First Goal
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {goals.map(goal => {
            const config = getStatusConfig(goal.status)
            return (
              <div
                key={goal.id}
                className="bg-[var(--v2-surface-hover)] rounded-xl p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-[var(--v2-text-muted)] capitalize">
                    {goal.label}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-xs ${config.bgColor} ${config.textColor}`}>
                    {config.label}
                  </span>
                </div>
                <div className="flex items-end gap-2 mb-2">
                  <span className="text-2xl font-bold text-[var(--v2-text-primary)]">
                    {formatValue(goal.current_value, goal.unit)}
                  </span>
                  <span className="text-sm text-[var(--v2-text-muted)] mb-1">
                    / {formatValue(goal.goal_value, goal.unit)} goal
                  </span>
                </div>
                <div className="w-full h-2 bg-[var(--v2-bg)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${config.barColor}`}
                    style={{ width: `${Math.min(goal.progress_pct, 100)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
