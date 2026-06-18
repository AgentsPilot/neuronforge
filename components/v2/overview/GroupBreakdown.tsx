'use client'

/**
 * GroupBreakdown - Metrics by user-defined groups
 *
 * Domain-agnostic visualization of performance across user-defined groups.
 * No hardcoded department or category names - all labels come from user data.
 */

import * as React from 'react'
import { Folder, ChevronRight, Clock, CheckCircle2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/design-system-v2'

export interface GroupMetrics {
  id: string
  name: string
  color?: string | null
  icon?: string | null
  workflow_count: number
  total_runs: number
  time_saved_seconds: number
  success_rate: number
}

export interface GroupBreakdownProps {
  groups: GroupMetrics[]
  onGroupClick?: (groupId: string) => void
  showEmpty?: boolean
  loading?: boolean
  className?: string
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.round((seconds % 3600) / 60)
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

function getStatusColor(successRate: number): string {
  if (successRate >= 0.95) return 'text-emerald-500'
  if (successRate >= 0.85) return 'text-amber-500'
  return 'text-red-500'
}

export function GroupBreakdown({
  groups,
  onGroupClick,
  showEmpty = false,
  loading = false,
  className,
}: GroupBreakdownProps) {
  const filteredGroups = showEmpty
    ? groups
    : groups.filter(g => g.workflow_count > 0 || g.total_runs > 0)

  if (loading) {
    return (
      <div className={cn('space-y-3', className)}>
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className="h-20 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse"
          />
        ))}
      </div>
    )
  }

  if (filteredGroups.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center py-12 text-center',
          'bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-700',
          className
        )}
      >
        <Folder className="h-12 w-12 text-slate-300 dark:text-slate-600 mb-3" />
        <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
          No groups defined yet
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
          Create groups to organize your workflows
        </p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      {filteredGroups.map(group => (
        <div
          key={group.id}
          className={cn(
            'flex items-center justify-between p-4 rounded-xl',
            'bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700',
            'transition-all duration-200',
            onGroupClick && 'cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-sm'
          )}
          onClick={() => onGroupClick?.(group.id)}
        >
          {/* Left: Group info */}
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor: group.color
                  ? `${group.color}20`
                  : 'rgb(99 102 241 / 0.1)',
              }}
            >
              <Folder
                className="h-5 w-5"
                style={{ color: group.color || '#6366f1' }}
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                {group.name}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {group.workflow_count} workflow{group.workflow_count !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          {/* Right: Metrics */}
          <div className="flex items-center gap-6">
            {/* Time saved */}
            <div className="text-right hidden sm:block">
              <div className="flex items-center gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
                <Clock className="h-3.5 w-3.5 text-slate-400" />
                <span>{formatTime(group.time_saved_seconds)}</span>
              </div>
              <p className="text-xs text-slate-500">saved</p>
            </div>

            {/* Runs */}
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {group.total_runs}
              </p>
              <p className="text-xs text-slate-500">runs</p>
            </div>

            {/* Success rate */}
            <div className="text-right">
              <div className={cn('flex items-center gap-1 text-sm font-medium', getStatusColor(group.success_rate))}>
                {group.success_rate >= 0.95 ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5" />
                )}
                <span>{(group.success_rate * 100).toFixed(0)}%</span>
              </div>
              <p className="text-xs text-slate-500">success</p>
            </div>

            {/* Arrow */}
            {onGroupClick && (
              <ChevronRight className="h-5 w-5 text-slate-300 dark:text-slate-600" />
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
